"""Raid-Helper: kommende Events des Discord-Servers samt Anmeldungen (nur für Mitglieder).
Der API-Schlüssel steht nur in der .env (RAIDHELPER_API_KEY) und verlässt den Server nie."""
import json
import re
import threading
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from . import models, notify
from .config import DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, PUBLIC_URL, _env
from .db import get_db
from .security import require_management, require_member

router = APIRouter(prefix="/api/raidhelper", tags=["raidhelper"])

API_KEY = _env("RAIDHELPER_API_KEY")
SERVER_ID = _env("RAIDHELPER_SERVER_ID") or DISCORD_GUILD_ID
BASE = _env("RAIDHELPER_BASE", "https://raid-helper.xyz/api/v4")
CACHE_SECONDS = 60
MAX_PAGES = 5

# Anmeldungen, die nicht "dabei" bedeuten (Raid-Helper-Standardklassen)
NOT_PLAYING = {"absence", "absent", "late", "tentative", "bench"}

_cache: dict = {"at": 0.0, "data": None}
_lock = threading.Lock()


def _ts(v) -> Optional[str]:
    """Raid-Helper liefert Unix-Zeit (Sekunden, manchmal als Text) -> ISO."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n > 1e12:  # Millisekunden
        n /= 1000
    return datetime.fromtimestamp(n, tz=timezone.utc).isoformat()


def _emote_id(v) -> str:
    v = str(v or "").strip()
    return v if v.isdigit() and len(v) <= 25 else ""


def _signup(s: dict) -> dict:
    cls = str(s.get("className") or s.get("roleName") or "").strip()
    return {
        "name": str(s.get("name") or "")[:64],
        "user_id": str(s.get("userId") or ""),
        "class": cls[:40],
        "spec": str(s.get("specName") or "").strip()[:40],
        "class_emote": _emote_id(s.get("classEmoteId")),
        "spec_emote": _emote_id(s.get("specEmoteId")),
        "role": str(s.get("roleName") or "").strip()[:40],
        "status": str(s.get("status") or "primary").lower(),
        "playing": cls.lower() not in NOT_PLAYING and str(s.get("status") or "primary").lower() == "primary",
        "position": s.get("position") or s.get("entryTime") or 0,
    }


CANCEL_PREFIX = "❌ CANCELLED – "


_CANCEL_RX = re.compile(r"^\s*(❌\s*((CANCELLED|ABGESAGT)\s*[–:-]?\s*)?|(CANCELLED|ABGESAGT)\s*[–:-]\s*)", re.I)


def _is_cancelled(title: str) -> bool:
    return bool(_CANCEL_RX.match(title or ""))


def _plain_title(title: str) -> str:
    """Titel ohne Absage-Markierung."""
    return _CANCEL_RX.sub("", title or "", count=1).strip() or (title or "")


def _event(e: dict) -> dict:
    signups = [_signup(s) for s in (e.get("signUps") or []) if isinstance(s, dict)]
    signups.sort(key=lambda x: (x["position"] if isinstance(x["position"], (int, float)) else 0))
    channel = str(e.get("channelId") or "")
    eid = str(e.get("id") or "")
    return {
        "id": eid,
        "title": str(e.get("title") or e.get("displayTitle") or "Event")[:120],
        "cancelled": _is_cancelled(str(e.get("title") or "")),
        "description": str(e.get("description") or "")[:500],
        "start": _ts(e.get("startTime")),
        "end": _ts(e.get("endTime")),
        "leader": str(e.get("leaderName") or "")[:64],
        "signups": signups,
        "count": sum(1 for s in signups if s["playing"]),
        "url": f"https://discord.com/channels/{SERVER_ID}/{channel}/{eid}" if channel and eid and SERVER_ID else None,
        "channel_id": channel,
        "channel_name": str(e.get("channelName") or "")[:80],
        "template_id": str(e.get("templateId") or "")[:20],
    }


def _fetch() -> dict:
    events, page, pages = [], 1, 1
    with httpx.Client(timeout=10, headers={"Authorization": API_KEY, "IncludeSignUps": "true",
                                           "User-Agent": "juiced-site"}) as c:
        while page <= min(pages, MAX_PAGES):
            r = c.get(f"{BASE}/servers/{SERVER_ID}/events", headers={"Page": str(page)})
            r.raise_for_status()
            data = r.json()
            events += [e for e in (data.get("postedEvents") or []) if isinstance(e, dict)]
            pages = int(data.get("pages") or 1)
            page += 1
    now = time.time()
    out = []
    # Kanäle und Vorlagen aus allen Events merken (für "Neues Event")
    channels: dict = {}
    templates: dict = {}
    for e in events:
        cid = str(e.get("channelId") or "")
        if cid:
            channels[cid] = str(e.get("channelName") or channels.get(cid) or "")[:80]
        tid = str(e.get("templateId") or "")
        if tid:
            templates[tid] = templates.get(tid, 0) + 1
    for e in events:
        ev = _event(e)
        try:
            start = float(e.get("startTime") or 0)
            end = float(e.get("endTime") or 0) or start + 3 * 3600
        except (TypeError, ValueError):
            continue
        if start > 1e12:
            start, end = start / 1000, end / 1000
        if end >= now - 3600:  # laufende und kommende Events
            out.append((start, ev))
    out.sort(key=lambda x: x[0])
    emotes = {}
    for e in events:
        for su in e.get("signUps") or []:
            if not isinstance(su, dict):
                continue
            for name_key, id_key in (("className", "classEmoteId"), ("specName", "specEmoteId")):
                n, i = str(su.get(name_key) or "").strip().lower()[:60], _emote_id(su.get(id_key))
                if n and i:
                    emotes[n] = i
    _save_emotes(emotes)
    return {"configured": True, "events": [ev for _, ev in out[:20]],
            "channels": [{"id": k, "name": v} for k, v in channels.items()],
            "template_id": max(templates, key=templates.get) if templates else ""}


def get_events() -> dict:
    if not API_KEY or not SERVER_ID:
        return {"configured": False, "events": []}
    with _lock:
        if _cache["data"] is not None and time.time() - _cache["at"] < CACHE_SECONDS:
            return _cache["data"]
        try:
            data = _fetch()
        except Exception as ex:  # Raid-Helper nicht erreichbar oder Schlüssel ungültig
            print(f"[raidhelper] Abruf fehlgeschlagen: {type(ex).__name__}")
            stale = _cache["data"]
            return {**stale, "stale": True} if stale else {"configured": True, "events": [], "error": "unavailable"}
        _cache.update(at=time.time(), data=data)
        return data


def _roster_out(r: Optional[models.Roster], names: dict) -> Optional[dict]:
    if not r:
        return None
    try:
        data = json.loads(r.data)
    except ValueError:
        return None
    at = r.updated_at
    if at and at.tzinfo is None:  # SQLite speichert ohne Zeitzone (UTC)
        at = at.replace(tzinfo=timezone.utc)
    return {**data, "updated_by": names.get(r.updated_by), "updated_at": at.isoformat() if at else None}


@router.get("/events")
def events(db: DbSession = Depends(get_db), user: models.User = Depends(require_member)):
    data = get_events()
    evs = data.get("events", [])
    # eigene Anmeldung markieren, gespeicherte Aufstellung und Website-Profile (Pfad) dazugeben
    mine = str(user.discord_id or "")
    rosters = {r.event_id: r for r in db.query(models.Roster).filter(models.Roster.event_id.in_([e["id"] for e in evs])).all()} if evs else {}
    users = db.query(models.User).filter(models.User.rank != "guest").all()
    names = {u.id: u.display_name for u in users}
    profiles = {u.discord_id: {"id": u.id, "name": u.display_name, "main_path": u.main_path, "main_role": u.main_role, "main_build": u.main_build,
                               "alt_paths": u.alt_path_list} for u in users}
    can_edit = user.level >= models.RANK_LEVEL["vice"]
    partners = _all_partnerships(db, users) if can_edit else []
    return {**data, "channels": _named_channels(data.get("channels") or []) if can_edit else [],
            "can_edit": can_edit, "partnerships": partners, "can_remind": bool(DISCORD_BOT_TOKEN and DISCORD_GUILD_ID) and can_edit,
            "profiles": {d: profiles[d] for e in evs for s in e["signups"] if (d := s["user_id"]) in profiles},
            "events": [{**e, "me": next((s for s in e["signups"] if s["user_id"] == mine), None),
                        "roster": _roster_out(rosters.get(e["id"]), names)} for e in evs]}


class RosterGroup(BaseModel):
    name: str = ""
    members: list[str] = []
    size: int = 10


class RosterIn(BaseModel):
    groups: list[RosterGroup] = []


_ID = re.compile(r"^[0-9A-Za-z_-]{1,40}$")


@router.put("/rosters/{event_id}")
def save_roster(event_id: str, payload: RosterIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    if not _ID.match(event_id):
        raise HTTPException(status_code=404, detail="Not found")
    seen: set[str] = set()
    groups = []
    for g in payload.groups[:20]:
        members = []
        for m in g.members[:60]:
            if _ID.match(m or "") and m not in seen:  # jeder Spieler höchstens einmal
                seen.add(m)
                members.append(m)
        groups.append({"name": " ".join((g.name or "").split())[:40], "members": members, "size": max(1, min(int(g.size or 10), 40))})
    r = db.get(models.Roster, event_id)
    if not groups:
        if r:
            db.delete(r)
            db.commit()
        return {"roster": None}
    if not r:
        r = models.Roster(event_id=event_id, data="")
        db.add(r)
    r.data = json.dumps({"groups": groups})
    r.updated_by = user.id
    db.commit()
    db.refresh(r)
    return {"roster": _roster_out(r, {user.id: user.display_name})}



# ------------------------------------------------------------------ schreiben: Event anlegen, Comp füllen + ankündigen

def _rh(method: str, path: str, body: Optional[dict] = None) -> dict:
    if not API_KEY or not SERVER_ID:
        raise HTTPException(status_code=503, detail="Raid-Helper is not configured")
    try:
        with httpx.Client(timeout=15, headers={"Authorization": API_KEY, "Content-Type": "application/json; charset=utf-8",
                                               "User-Agent": "juiced-site"}) as c:
            r = c.request(method, f"{BASE}{path}", json=body)
    except httpx.HTTPError as ex:
        print(f"[raidhelper] {method} {path}: {type(ex).__name__}")
        raise HTTPException(status_code=502, detail="Raid-Helper is not reachable")
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400 or (isinstance(data, dict) and data.get("status") == "failed"):
        reason = str((data or {}).get("reason") or r.status_code)[:200] if isinstance(data, dict) else str(r.status_code)
        print(f"[raidhelper] {method} {path} -> {r.status_code} {reason}")
        raise HTTPException(status_code=502, detail=f"Raid-Helper: {reason}")
    return data if isinstance(data, dict) else {}


def _drop_cache():
    with _lock:
        _cache.update(at=0.0, data=None)


class EventIn(BaseModel):
    channel_id: str
    title: str
    description: str = ""
    start: datetime
    template_id: Optional[str] = None


@router.post("/events")
def create_event(payload: EventIn, user: models.User = Depends(require_management)):
    if not _ID.match(payload.channel_id or ""):
        raise HTTPException(status_code=400, detail="Please choose a channel")
    title = " ".join((payload.title or "").split())[:100]
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    start = payload.start if payload.start.tzinfo else payload.start.replace(tzinfo=timezone.utc)
    if start.timestamp() < time.time() - 300:
        raise HTTPException(status_code=400, detail="The start must be in the future")
    ts = str(int(start.timestamp()))
    body = {"leaderId": str(user.discord_id), "date": ts, "time": ts, "title": title,
            "description": (payload.description or "").strip()[:1500]}
    tid = payload.template_id or (get_events().get("template_id") if API_KEY else "")
    if tid and re.fullmatch(r"[0-9A-Za-z_-]{1,20}", tid):
        body["templateId"] = tid
    data = _rh("POST", f"/servers/{SERVER_ID}/channels/{payload.channel_id}/event", body)
    _drop_cache()
    ev = data.get("event") or {}
    return {"ok": True, "id": str(ev.get("id") or "")}


class PushIn(BaseModel):
    announce: bool = False
    channel_id: Optional[str] = None
    mention: bool = False
    description: str = ""


@router.post("/rosters/{event_id}/push")
def push_roster(event_id: str, payload: PushIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    """Gespeicherte Aufstellung ins Comp-Tool von Raid-Helper übertragen (Comp-ID = Event-ID), optional ankündigen."""
    if not _ID.match(event_id):
        raise HTTPException(status_code=404, detail="Not found")
    r = db.get(models.Roster, event_id)
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    groups = json.loads(r.data).get("groups") or []
    ev = next((e for e in get_events().get("events", []) if e["id"] == event_id), None)
    if not ev:
        raise HTTPException(status_code=404, detail="Not found")
    signups = {s["user_id"]: s for s in ev["signups"]}
    users = {u.discord_id: u for u in db.query(models.User).filter(models.User.discord_id.in_(
        [m for g in groups for m in g["members"]])).all()} if groups else {}
    slot_count = max([len(g["members"]) for g in groups] + [1])
    slots = []
    for gi, g in enumerate(groups):
        for si, uid in enumerate(g["members"]):
            s = signups.get(uid) or {}
            u = users.get(uid)
            slot = {"userId": uid, "name": s.get("name") or (u.display_name if u else uid),
                    "groupNumber": gi + 1, "slotNumber": si + 1}
            if s.get("class"):
                slot["className"] = s["class"]
            if s.get("spec"):
                slot["specName"] = s["spec"]
            slots.append(slot)
    body = {"groupCount": max(len(groups), 1), "slotCount": slot_count, "slots": slots}
    # Gruppennamen: Form der vorhandenen Gruppen übernehmen (Raid-Helper liefert sie beim Abruf mit)
    try:
        current = httpx.get(f"{BASE}/comps/{event_id}", timeout=10, headers={"User-Agent": "juiced-site"}).json()
        cur_groups = current.get("groups") if isinstance(current, dict) else None
    except (httpx.HTTPError, ValueError):
        cur_groups = None
    if isinstance(cur_groups, list) and cur_groups and isinstance(cur_groups[0], dict) and any(g.get("name") for g in groups):
        key = "name" if "name" in cur_groups[0] else "groupName" if "groupName" in cur_groups[0] else None
        if key:
            out = []
            for gi, g in enumerate(groups):
                base = dict(cur_groups[gi]) if gi < len(cur_groups) else {k: v for k, v in cur_groups[0].items() if k != key}
                base[key] = g.get("name") or f"Group {gi + 1}"
                if "groupNumber" in base:
                    base["groupNumber"] = gi + 1
                out.append(base)
            body["groups"] = out
    _rh("PATCH", f"/comps/{event_id}", body)
    announced = False
    if payload.announce:
        channel = payload.channel_id or ev.get("channel_id")
        if not channel or not _ID.match(channel):
            raise HTTPException(status_code=400, detail="Please choose a channel")
        _rh("POST", f"/comps/{event_id}/announcements", {
            "channelId": channel, "description": (payload.description or "").strip()[:500],
            "mentions": "signed" if payload.mention else "none"})
        announced = True
    return {"ok": True, "announced": announced, "url": f"https://raid-helper.xyz/comp/{event_id}"}



# ------------------------------------------------------------------ "unsigned": wer mit Rolle X hat noch nicht reagiert (eigener Bot)

DISCORD_API = _env("DISCORD_API_BASE", "https://discord.com/api/v10")  # nur für Tests umstellbar
_dc_cache: dict = {}


def _discord(method: str, path: str, **kw):
    if not DISCORD_BOT_TOKEN or not DISCORD_GUILD_ID:
        raise HTTPException(status_code=503, detail="Discord bot is not configured")
    try:
        r = httpx.request(method, f"{DISCORD_API}{path}", timeout=15,
                          headers={"Authorization": f"Bot {DISCORD_BOT_TOKEN}", "User-Agent": "juiced-site (https://juiced.team, 1)"}, **kw)
    except httpx.HTTPError as ex:
        print(f"[discord] {method} {path}: {type(ex).__name__}")
        raise HTTPException(status_code=502, detail="Discord is not reachable")
    if r.status_code in (401, 403):
        print(f"[discord] {method} {path} -> {r.status_code} {r.text[:200]}")
        raise HTTPException(status_code=502, detail="Discord bot has no access")
    if r.status_code >= 400:
        print(f"[discord] {method} {path} -> {r.status_code} {r.text[:200]}")
        raise HTTPException(status_code=502, detail="Discord is not reachable")
    return r.json() if r.content else None


def _cached(key: str, ttl: int, fn):
    hit = _dc_cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _dc_cache[key] = (time.time(), val)
    return val


def _guild_channels() -> list:
    def load():
        chans = _discord("GET", f"/guilds/{DISCORD_GUILD_ID}/channels") or []
        chans = [c for c in chans if c.get("type") in (0, 5)]  # Text- und Ankündigungskanäle
        chans.sort(key=lambda c: int(c.get("position") or 0))
        return [{"id": str(c["id"]), "name": str(c.get("name") or "")[:80]} for c in chans]
    return _cached("channels", 300, load)


def _named_channels(event_channels: list) -> list:
    """Kanäle mit Namen (über den Bot): erst die Event-Kanäle, dann alle übrigen Textkanäle."""
    try:
        named = _guild_channels() if DISCORD_BOT_TOKEN and DISCORD_GUILD_ID else []
    except HTTPException:
        named = []
    names = {c["id"]: c["name"] for c in named}
    first = [{"id": c["id"], "name": names.get(c["id"]) or c.get("name") or ""} for c in event_channels]
    seen = {c["id"] for c in first}
    return first + [c for c in named if c["id"] not in seen]


def _guild_roles() -> list:
    def load():
        roles = _discord("GET", f"/guilds/{DISCORD_GUILD_ID}/roles") or []
        roles = [r for r in roles if r.get("name") != "@everyone" and not (r.get("managed") or False)]
        roles.sort(key=lambda r: -int(r.get("position") or 0))
        return [{"id": str(r["id"]), "name": str(r.get("name") or "")[:60], "color": int(r.get("color") or 0)} for r in roles]
    return _cached("roles", 300, load)


def _guild_members() -> list:
    """Alle Mitglieder des Servers (braucht im Bot den 'Server Members Intent')."""
    def load():
        out, after = [], "0"
        for _ in range(20):  # bis 20.000 Mitglieder
            page = _discord("GET", f"/guilds/{DISCORD_GUILD_ID}/members", params={"limit": 1000, "after": after}) or []
            out += page
            if len(page) < 1000:
                break
            after = page[-1]["user"]["id"]
        return [{"id": str(m["user"]["id"]), "name": str(m.get("nick") or m["user"].get("global_name") or m["user"].get("username") or "")[:64],
                 "roles": [str(x) for x in m.get("roles") or []]} for m in out if not m["user"].get("bot")]
    return _cached("members", 60, load)


@router.get("/roles")
def roles(user: models.User = Depends(require_management)):
    return _guild_roles()


def _unsigned(ev: dict, role_id: str) -> list:
    signed = {s["user_id"] for s in ev["signups"]}  # jede Reaktion zählt (auch Abwesend), wie bei Raid-Helper
    return sorted((m for m in _guild_members() if role_id in m["roles"] and m["id"] not in signed), key=lambda m: m["name"].lower())


def _find_event(event_id: str) -> dict:
    ev = next((e for e in get_events().get("events", []) if e["id"] == event_id), None) if _ID.match(event_id) else None
    if not ev:
        raise HTTPException(status_code=404, detail="Not found")
    return ev


@router.get("/events/{event_id}/unsigned")
def unsigned(event_id: str, role: str, user: models.User = Depends(require_management)):
    if not _ID.match(role or ""):
        raise HTTPException(status_code=400, detail="Please choose a role")
    return [{"id": m["id"], "name": m["name"]} for m in _unsigned(_find_event(event_id), role)]


class RemindIn(BaseModel):
    role_id: str
    channel_id: Optional[str] = None
    text: str = ""
    ping: bool = True
    dm: bool = False


@router.post("/events/{event_id}/remind")
def remind(event_id: str, payload: RemindIn, user: models.User = Depends(require_management)):
    """Wie /unsigned bei Raid-Helper: alle mit der Rolle, die noch nicht reagiert haben, im Kanal pingen und/oder per DM erinnern."""
    if not _ID.match(payload.role_id or ""):
        raise HTTPException(status_code=400, detail="Please choose a role")
    ev = _find_event(event_id)
    missing = _unsigned(ev, payload.role_id)
    text = (payload.text or "").strip()[:800]
    if payload.ping and missing:
        channel = payload.channel_id or ev.get("channel_id")
        if not channel or not _ID.match(channel):
            raise HTTPException(status_code=400, detail="Please choose a channel")
        head = "\n".join(x for x in (f"**{ev['title']}**" + (f" · {text}" if text else ""), ev.get("url") or "") if x)
        # Erwähnungen auf mehrere Nachrichten verteilen (max. 2000 Zeichen)
        chunks, cur = [], head + "\n"
        for m in missing:
            tag = f"<@{m['id']}> "
            if len(cur) + len(tag) > 1900:
                chunks.append(cur)
                cur = ""
            cur += tag
        chunks.append(cur)
        for c in chunks:
            _discord("POST", f"/channels/{channel}/messages", json={
                "content": c, "allowed_mentions": {"parse": [], "users": [m["id"] for m in missing if m["id"] in c][:100]}})
    if payload.dm and missing:
        notify.dm([m["id"] for m in missing], f"⏰ {ev['title']}", text or "Please sign up in Raid-Helper.", "/en/app/#/signups")
    return {"ok": True, "count": len(missing)}



# ------------------------------------------------------------------ Partnerschaften (wer zusammen in eine Gruppe soll)

def _norm(v: str) -> str:
    return re.sub(r"[\W_]+", "", (v or "").lower())


def _candidates(db: DbSession) -> dict:
    """Alle bekannten Namen -> Discord-ID: Discord-Mitglieder (Bot), Website-Profile, Raid-Helper-Anmeldungen."""
    out: dict = {}  # discord_id -> {"name", "keys": set}

    def add(did: str, name: str, *keys: str):
        if not did:
            return
        c = out.setdefault(did, {"name": name, "keys": set()})
        c["keys"].update(_norm(k) for k in (name, *keys) if _norm(k))

    try:
        for m in _guild_members():
            add(m["id"], m["name"])
    except HTTPException:
        pass  # ohne Bot nur Website + Anmeldungen
    for u in db.query(models.User).all():
        add(u.discord_id, u.display_name, u.username, u.global_name or "", u.ingame_name or "")
    for e in get_events().get("events", []):
        for su in e["signups"]:
            add(su["user_id"], su["name"])
    return out


def _resolve(name: str, cands: dict) -> dict:
    """Exakt (ohne Groß/Klein, Sonderzeichen) = sicher; eindeutiger Teil-Treffer = unsicher; sonst nicht gefunden."""
    n = _norm(name)
    if not n:
        return {"input": name, "status": "missing"}
    exact = [d for d, c in cands.items() if n in c["keys"]]
    if len(exact) == 1:
        return {"input": name, "id": exact[0], "name": cands[exact[0]]["name"], "status": "ok"}
    part = [d for d, c in cands.items() if any(n in k or (len(k) >= 3 and k in n) for k in c["keys"])] if len(n) >= 3 else []
    if len(exact) > 1:
        part = exact
    if len(part) == 1:
        return {"input": name, "id": part[0], "name": cands[part[0]]["name"], "status": "unsure"}
    return {"input": name, "status": "ambiguous" if part else "missing",
            "options": [{"id": d, "name": cands[d]["name"]} for d in part[:5]]}


def _parse(text: str) -> list:
    lines = []
    for raw in (text or "").splitlines()[:100]:
        names = [x.strip() for x in re.split(r",|;|\+|&|\band\b|\bund\b|\s/\s", raw) if x.strip()]
        if names:
            lines.append(names[:20])
    return lines


class PartnersIn(BaseModel):
    text: str = ""


@router.get("/partnerships")
def get_partnerships(db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    return [{"id": x.id, "members": json.loads(x.members)} for x in db.query(models.Partnership).order_by(models.Partnership.position).all()]


@router.post("/partnerships/check")
def check_partnerships(payload: PartnersIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    cands = _candidates(db)
    return [[_resolve(n, cands) for n in line] for line in _parse(payload.text)]


@router.put("/partnerships")
def save_partnerships(payload: PartnersIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    """Ersetzt die Liste. Jede Zeile = eine Partnerschaft; nur gefundene Namen (sicher/unsicher) werden gespeichert."""
    cands = _candidates(db)
    report = [[_resolve(n, cands) for n in line] for line in _parse(payload.text)]
    db.query(models.Partnership).delete()
    pos = 0
    for line in report:
        seen, members = set(), []
        for r in line:
            if r.get("id") and r["id"] not in seen:
                seen.add(r["id"])
                members.append({"id": r["id"], "name": r["name"]})
        if len(members) >= 2:
            db.add(models.Partnership(members=json.dumps(members), position=pos))
            pos += 1
    db.commit()
    return {"saved": pos, "report": report}



# ------------------------------------------------------------------ Absagen / wieder aktivieren / löschen

class CancelIn(BaseModel):
    reason: str = ""
    ping: bool = False


@router.post("/events/{event_id}/cancel")
def cancel_event(event_id: str, payload: CancelIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    """Event bleibt stehen, Titel bekommt "❌ CANCELLED"; optional werden alle Angemeldeten im Kanal gepingt."""
    ev = _find_event(event_id)
    reason = " ".join((payload.reason or "").split())[:300]
    _rh("PATCH", f"/events/{event_id}", {"title": (CANCEL_PREFIX + _plain_title(ev["title"]))[:100]})
    _drop_cache()
    pinged = 0
    if payload.ping and DISCORD_BOT_TOKEN and ev.get("channel_id"):
        ids = list(dict.fromkeys(s["user_id"] for s in ev["signups"] if s["user_id"] and s["status"] == "primary" and s["class"].lower() not in ("absence", "absent")))
        head = f"❌ **{_plain_title(ev['title'])}** – cancelled" + (f": {reason}" if reason else "") + (f"\n{ev['url']}" if ev.get("url") else "")
        chunks, cur = [], head + "\n"
        for uid in ids:
            tag = f"<@{uid}> "
            if len(cur) + len(tag) > 1900:
                chunks.append(cur)
                cur = ""
            cur += tag
        chunks.append(cur)
        for c in chunks:
            _discord("POST", f"/channels/{ev['channel_id']}/messages", json={
                "content": c, "allowed_mentions": {"parse": [], "users": [u for u in ids if u in c][:100]}})
        pinged = len(ids)
    return {"ok": True, "pinged": pinged}


@router.post("/events/{event_id}/restore")
def restore_event(event_id: str, user: models.User = Depends(require_management)):
    ev = _find_event(event_id)
    _rh("PATCH", f"/events/{event_id}", {"title": _plain_title(ev["title"])[:100]})
    _drop_cache()
    return {"ok": True}


@router.delete("/events/{event_id}")
def delete_event(event_id: str, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    _find_event(event_id)
    _rh("DELETE", f"/events/{event_id}")
    r = db.get(models.Roster, event_id)
    if r:
        db.delete(r)
        db.commit()
    _drop_cache()
    return {"ok": True}



def _all_partnerships(db: DbSession, users=None) -> list:
    """Leader-Liste + was Mitglieder im Profil als Partner eingetragen haben."""
    out = [[m["id"] for m in json.loads(x.members)] for x in db.query(models.Partnership).order_by(models.Partnership.position).all()]
    for u in users if users is not None else db.query(models.User).all():
        if u.partner_list:
            out.append([u.discord_id, *u.partner_list])
    return out


@router.get("/people")
def people(db: DbSession = Depends(get_db), user: models.User = Depends(require_member)):
    """Personen zum Auswählen (z. B. Partner im Profil): Discord-Mitglieder über den Bot, sonst Website-Mitglieder."""
    try:
        members = _guild_members()
        if members:
            return sorted(({"id": m["id"], "name": m["name"]} for m in members), key=lambda m: m["name"].lower())
    except HTTPException:
        pass
    return sorted(({"id": u.discord_id, "name": u.display_name} for u in db.query(models.User).filter(models.User.rank != "guest").all()),
                  key=lambda m: m["name"].lower())


@router.get("/profile-partnerships")
def profile_partnerships(db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    """Für das Leader-Fenster: welche Partner die Mitglieder selbst eingetragen haben."""
    try:
        names = {m["id"]: m["name"] for m in _guild_members()}
    except HTTPException:
        names = {}
    users = db.query(models.User).all()
    names.update({u.discord_id: u.display_name for u in users})
    return [{"owner": names.get(u.discord_id, u.display_name), "partners": [names.get(pid, pid) for pid in u.partner_list]}
            for u in users if u.partner_list]



# ------------------------------------------------------------------ Icons (Raid-Helper-Emotes)

def _save_emotes(emotes: dict):
    if not emotes:
        return
    from .db import SessionLocal
    db = SessionLocal()
    try:
        have = {e.name: e for e in db.query(models.Emote).all()}
        for n, i in emotes.items():
            if n in have:
                have[n].emote_id = i
            else:
                db.add(models.Emote(name=n, emote_id=i))
        db.commit()
    except Exception as ex:  # Icons sind nur Deko
        print(f"[raidhelper] Emotes nicht gespeichert: {type(ex).__name__}")
        db.rollback()
    finally:
        db.close()


@router.get("/emotes")
def emotes(db: DbSession = Depends(get_db), user: models.User = Depends(require_member)):
    """Name (klein) -> Discord-Emote-ID, z. B. {"bellstrike": "123", "bamboocut_wind": "456"}."""
    return {e.name: e.emote_id for e in db.query(models.Emote).all()}


# ------------------------------------------------------------------ Anwesenheit (Raid-Helper-Statistik)

_att_cache: dict = {}
_ATT_KEYS = {
    "id": ("userId", "user_id", "id", "discordId"),
    "name": ("name", "userName", "displayName"),
    "attended": ("attendance", "attended", "eventsAttended", "count", "signups"),
    "total": ("totalEvents", "total", "events", "possible", "eventCount"),
    "pct": ("percentage", "percent", "attendancePercentage", "rate"),
}


def _pick(d: dict, key: str):
    for k in _ATT_KEYS[key]:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _num(v) -> Optional[float]:
    try:
        return float(str(v).rstrip("%"))
    except (TypeError, ValueError):
        return None


def get_attendance(days: int) -> dict:
    """Discord-ID -> {attended, total, pct} der letzten `days` Tage (geschlossene Events)."""
    if not API_KEY or not SERVER_ID:
        return {"configured": False, "members": {}}
    hit = _att_cache.get(days)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    now = int(time.time())
    try:
        with httpx.Client(timeout=15, headers={"Authorization": API_KEY, "User-Agent": "juiced-site",
                                               "TimeFilterStart": str(now - days * 86400), "TimeFilterEnd": str(now)}) as c:
            r = c.get(f"{BASE}/servers/{SERVER_ID}/attendance")
            r.raise_for_status()
            data = r.json()
    except Exception as ex:
        print(f"[raidhelper] Anwesenheit nicht abrufbar: {type(ex).__name__}")
        return hit[1] if hit else {"configured": True, "members": {}, "error": "unavailable"}
    rows = data.get("result") if isinstance(data, dict) else data
    rows = rows if isinstance(rows, list) else []
    if rows and isinstance(rows[0], dict) and not _att_cache.get("logged"):
        print(f"[raidhelper] Anwesenheit: Felder {sorted(rows[0].keys())}")  # einmalig, zum Nachjustieren
        _att_cache["logged"] = (0, True)
    members = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        uid = str(_pick(row, "id") or "")
        if not uid:
            continue
        attended, total, pct = _num(_pick(row, "attended")), _num(_pick(row, "total")), _num(_pick(row, "pct"))
        if pct is None and attended is not None and total:
            pct = attended / total * 100
        members[uid] = {"attended": int(attended) if attended is not None else None,
                        "total": int(total) if total is not None else None,
                        "pct": round(pct) if pct is not None else None}
    out = {"configured": True, "days": days, "members": members}
    _att_cache[days] = (time.time(), out)
    return out


@router.get("/attendance")
def attendance(days: int = 30, user: models.User = Depends(require_member)):
    return get_attendance(max(7, min(days, 180)))
