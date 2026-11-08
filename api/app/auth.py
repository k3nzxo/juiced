"""Login mit Discord (OAuth2 Authorization Code). Rollen werden optional vom JUICED-Server übernommen."""
import re
import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session as DbSession

from . import models
from .config import (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID, IS_PROD,
                     OWNER_DISCORD_IDS, PUBLIC_URL, ROLE_MAP, SESSION_COOKIE)
from .db import get_db
from .security import (client_ip, create_session, current_user_optional, destroy_session, limiter,
                       set_session_cookie, sign, unsign)

router = APIRouter(prefix="/api/auth", tags=["auth"])

API = "https://discord.com/api/v10"
STATE_COOKIE = "juiced_oauth"
REDIRECT_URI = f"{PUBLIC_URL}/api/auth/callback"


def _safe_next(nxt: str | None) -> str:
    # nur relative Pfade auf der eigenen Seite (kein Open Redirect)
    if not nxt or not nxt.startswith("/") or nxt.startswith("//") or "\\" in nxt:
        return "/"
    return nxt[:300]


def user_out(u: models.User) -> dict:
    return {
        "id": u.id, "discord_id": u.discord_id, "username": u.username, "display_name": u.display_name,
        "avatar_url": u.avatar_url, "rank": u.rank, "public_rank": u.public_rank, "coach_roles": u.coach_list,
        "ingame_name": u.ingame_name, "main_role": u.main_role, "weapons": u.weapon_list, "weapon_other": u.weapon_other,
        "main_path": u.main_path, "alt_paths": u.alt_path_list, "inner_ways": u.inner_way_list, "partners": u.partner_list,
        "main_build": u.main_build, "alt_builds": u.alt_build_list,
        "country": u.country,
        "show_on_team": u.show_on_team, "lang": u.lang, "in_guild": u.in_guild, "rank_manual": u.rank_manual,
        "can_manage": u.level >= models.RANK_LEVEL["vice"], "is_admin": u.level >= models.RANK_LEVEL["vice"],
        "is_member": u.level >= models.RANK_LEVEL["member"],
    }


def apply_discord_roles(u: models.User, role_ids: list[str] | None):
    """Rang + Coach-Rollen aus den Discord-Rollen ableiten (nur wenn nicht manuell überschrieben)."""
    if u.discord_id in OWNER_DISCORD_IDS:
        u.rank = "developer"
        if role_ids is not None:
            u.coach_roles = ",".join(r for r in models.COACH_ROLES
                                     if any(ROLE_MAP.get(i) == f"coach_{r}" for i in role_ids)) or u.coach_roles
        return
    if u.rank_manual or not ROLE_MAP or role_ids is None:
        return
    mapped = {ROLE_MAP[i] for i in role_ids if i in ROLE_MAP}
    rank = "guest"
    for r in ("member", "vice", "leader"):  # aufsteigend -> höchster gewinnt
        if r in mapped:
            rank = r
    coaches = [r for r in models.COACH_ROLES if f"coach_{r}" in mapped]
    if coaches and rank == "guest":
        rank = "member"
    u.rank = rank
    u.coach_roles = ",".join(coaches)


@router.get("/login")
def login(request: Request, next: str | None = None):
    if not DISCORD_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Discord login is not configured yet")
    limiter.check("login:" + client_ip(request), 30, 600)
    state = secrets.token_urlsafe(24)
    scopes = ["identify"] + (["guilds.members.read"] if DISCORD_GUILD_ID else [])
    url = "https://discord.com/oauth2/authorize?" + urlencode({
        "client_id": DISCORD_CLIENT_ID, "response_type": "code", "redirect_uri": REDIRECT_URI,
        "scope": " ".join(scopes), "state": state, "prompt": "none",
    })
    resp = RedirectResponse(url, status_code=302)
    resp.set_cookie(STATE_COOKIE, sign(f"{state}|{_safe_next(next)}"), max_age=600, httponly=True,
                    secure=IS_PROD, samesite="lax", path="/api/auth")
    # nie zwischenspeichern: jede Weiterleitung hat ihren eigenen Sicherheitscode (state)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@router.get("/callback")
def callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None,
             db: DbSession = Depends(get_db)):
    raw = unsign(request.cookies.get(STATE_COOKIE, ""))
    if not raw or "|" not in raw:
        lang = request.cookies.get("juiced_lang", "en")
        lang = lang if re.fullmatch(r"[a-z]{2}", lang or "") else "en"
        return RedirectResponse(f"/{lang}/app/?login=expired", status_code=302)
    expected, nxt = raw.split("|", 1)
    if error or not code or not state or not secrets.compare_digest(state, expected):
        path, _, frag = nxt.partition("#")  # Hinweis vor das #, sonst sieht die Seite ihn nicht
        if "?" not in path:
            path += "?login=cancelled"
        return RedirectResponse(path + (f"#{frag}" if frag else ""), status_code=302)

    try:
        with httpx.Client(timeout=10) as c:
            tok = c.post(f"{API}/oauth2/token", data={
                "grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT_URI,
            }, auth=(DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET), headers={"Content-Type": "application/x-www-form-urlencoded"})
            tok.raise_for_status()
            access = tok.json()["access_token"]
            h = {"Authorization": f"Bearer {access}"}
            me = c.get(f"{API}/users/@me", headers=h)
            me.raise_for_status()
            me = me.json()
            role_ids, in_guild = None, False
            if DISCORD_GUILD_ID:
                gm = c.get(f"{API}/users/@me/guilds/{DISCORD_GUILD_ID}/member", headers=h)
                if gm.status_code == 200:
                    role_ids, in_guild = gm.json().get("roles", []), True
                elif gm.status_code == 404:
                    role_ids = []  # nicht auf dem Server
    except Exception as e:
        print(f"[auth] Discord-Login fehlgeschlagen: {e}")
        return RedirectResponse("/?login=error", status_code=302)

    u = db.query(models.User).filter(models.User.discord_id == str(me["id"])).first()
    if not u:
        u = models.User(discord_id=str(me["id"]), username=me.get("username") or "user", rank="guest")
        db.add(u)
    u.username = me.get("username") or u.username
    u.global_name = me.get("global_name")
    u.avatar_hash = me.get("avatar")
    u.in_guild = in_guild
    u.last_login_at = datetime.now(timezone.utc)
    apply_discord_roles(u, role_ids)
    db.commit()
    db.refresh(u)

    token = create_session(db, u)
    resp = RedirectResponse(nxt, status_code=302)
    set_session_cookie(resp, token)
    resp.delete_cookie(STATE_COOKIE, path="/api/auth")
    return resp


@router.post("/logout")
def logout(request: Request, db: DbSession = Depends(get_db)):
    destroy_session(db, request.cookies.get(SESSION_COOKIE))
    out = JSONResponse({"ok": True})
    out.delete_cookie(SESSION_COOKIE, path="/")
    return out


if not IS_PROD and __import__("os").environ.get("DEV_LOGIN") == "1":
    @router.get("/dev-login")
    def dev_login(name: str = "tester", rank: str = "member", coach: str = "", db: DbSession = Depends(get_db)):
        """NUR lokal (ENV != prod und DEV_LOGIN=1): Test-Login ohne Discord."""
        u = db.query(models.User).filter(models.User.discord_id == f"dev-{name}").first()
        if not u:
            u = models.User(discord_id=f"dev-{name}", username=name)
            db.add(u)
        u.rank = rank if rank in models.RANKS else "member"
        u.coach_roles = coach
        db.commit()
        db.refresh(u)
        resp = RedirectResponse("/en/app/", status_code=302)
        set_session_cookie(resp, create_session(db, u))
        return resp


@router.get("/me")
def me(user: models.User | None = Depends(current_user_optional)):
    return {"user": user_out(user) if user else None, "login_configured": bool(DISCORD_CLIENT_ID)}
