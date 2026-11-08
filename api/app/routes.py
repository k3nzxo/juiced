from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from . import models, notify
from .auth import user_out
from .db import get_db
from .security import client_ip, limiter, require_admin, require_management, require_member, require_user

router = APIRouter(prefix="/api", tags=["site"])
LANGS = {"en", "de", "fr", "es", "pt", "ru", "tr", "pl"}


def clean(s: Optional[str], n: int) -> Optional[str]:
    s = (s or "").strip()
    return s[:n] or None


def iso(dt) -> Optional[str]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


# ------------------------------------------------------------------ öffentlich

@router.get("/team")
def team(db: DbSession = Depends(get_db)):
    users = db.query(models.User).filter(models.User.rank != "guest", models.User.show_on_team == True).all()  # noqa: E712
    order = {"leader": 0, "vice": 1, "coach": 3, "member": 4}
    users.sort(key=lambda u: (order.get(u.public_rank, 9), u.display_name.lower()))
    return {"members": [{
        "display_name": u.display_name, "avatar_url": u.avatar_url, "rank": u.public_rank,
        "coach_roles": u.coach_list, "main_role": u.main_role, "country": u.country,
    } for u in users]}


class ApplicationIn(BaseModel):
    discord: str
    ingame: str
    main_role: str
    country: str
    times: str
    experience: str
    why: Optional[str] = None
    lang: Optional[str] = None
    website: Optional[str] = None  # Honeypot


@router.post("/applications")
def apply(payload: ApplicationIn, request: Request, db: DbSession = Depends(get_db)):
    ip = client_ip(request)
    limiter.check("apply:" + ip, 3, 3600)
    if payload.website:  # Bot -> so tun, als wäre alles gut
        return {"ok": True}
    fields = dict(discord=clean(payload.discord, 64), ingame=clean(payload.ingame, 64), country=clean(payload.country, 64),
                  times=clean(payload.times, 120), experience=clean(payload.experience, 2000))
    if not all(fields.values()) or payload.main_role not in models.MAIN_ROLES:
        raise HTTPException(status_code=400, detail="Missing fields")
    a = models.Application(**fields, main_role=payload.main_role, why=clean(payload.why, 2000),
                           lang=payload.lang if payload.lang in LANGS else None)
    db.add(a)
    db.commit()
    notify.application_webhook(a)
    return {"ok": True}


# ------------------------------------------------------------------ eigenes Profil

class ProfileIn(BaseModel):
    ingame_name: Optional[str] = None
    main_role: Optional[str] = None
    country: Optional[str] = None
    show_on_team: Optional[bool] = None
    lang: Optional[str] = None


@router.put("/me")
def update_me(payload: ProfileIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_user)):
    data = payload.model_dump(exclude_unset=True)
    if "ingame_name" in data:
        user.ingame_name = clean(data["ingame_name"], 40)
    if "main_role" in data:
        user.main_role = data["main_role"] if data["main_role"] in models.MAIN_ROLES else None
    if "country" in data:
        cc = (data["country"] or "").strip().upper()
        user.country = cc if len(cc) == 2 and cc.isalpha() else None
    if "show_on_team" in data and data["show_on_team"] is not None:
        user.show_on_team = bool(data["show_on_team"])
    if "lang" in data:
        user.lang = data["lang"] if data["lang"] in LANGS else None
    db.commit()
    return {"user": user_out(user)}


@router.get("/members")
def members(db: DbSession = Depends(get_db), user: models.User = Depends(require_member)):
    users = db.query(models.User).filter(models.User.rank != "guest").all()
    order = {"leader": 0, "vice": 1, "coach": 3, "member": 4}
    users.sort(key=lambda u: (order.get(u.public_rank, 9), u.display_name.lower()))
    return [{"id": u.id, "display_name": u.display_name, "username": u.username, "avatar_url": u.avatar_url,
             "rank": u.public_rank, "coach_roles": u.coach_list, "main_role": u.main_role, "country": u.country,
             "last_login_at": iso(u.last_login_at)} for u in users]


# ------------------------------------------------------------------ Ankündigungen

class AnnouncementIn(BaseModel):
    title: str
    body: str
    pinned: bool = False


def ann_out(a: models.Announcement, users: dict, me: models.User) -> dict:
    au = users.get(a.author_id)
    return {"id": a.id, "title": a.title, "body": a.body, "pinned": a.pinned,
            "author": au.display_name if au else None, "author_avatar": au.avatar_url if au else None,
            "created_at": iso(a.created_at), "edited": bool(a.updated_at),
            "can_edit": me.level >= models.RANK_LEVEL["vice"]}


@router.get("/announcements")
def list_announcements(db: DbSession = Depends(get_db), user: models.User = Depends(require_member)):
    items = db.query(models.Announcement).order_by(models.Announcement.pinned.desc(), models.Announcement.created_at.desc()).limit(50).all()
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_({a.author_id for a in items})).all()}
    return [ann_out(a, users, user) for a in items]


@router.post("/announcements")
def create_announcement(payload: AnnouncementIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    title, body = clean(payload.title, 160), clean(payload.body, 8000)
    if not title or not body:
        raise HTTPException(status_code=400, detail="Missing fields")
    a = models.Announcement(title=title, body=body, pinned=payload.pinned, author_id=user.id)
    db.add(a)
    db.commit()
    db.refresh(a)
    return ann_out(a, {user.id: user}, user)


@router.put("/announcements/{aid}")
def update_announcement(aid: int, payload: AnnouncementIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    a = db.get(models.Announcement, aid)
    if not a:
        raise HTTPException(status_code=404, detail="Not found")
    title, body = clean(payload.title, 160), clean(payload.body, 8000)
    if not title or not body:
        raise HTTPException(status_code=400, detail="Missing fields")
    a.title, a.body, a.pinned, a.updated_at = title, body, payload.pinned, datetime.now(timezone.utc)
    db.commit()
    users = {u.id: u for u in db.query(models.User).filter(models.User.id == a.author_id).all()}
    return ann_out(a, users, user)


@router.delete("/announcements/{aid}")
def delete_announcement(aid: int, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    db.query(models.Announcement).filter(models.Announcement.id == aid).delete()
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ Bewerbungen (Leader / Vice)

def _cleanup_applications(db: DbSession):
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    db.query(models.Application).filter(models.Application.status != "pending", models.Application.decided_at < cutoff).delete()
    db.commit()


@router.get("/applications")
def list_applications(db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    _cleanup_applications(db)
    apps = db.query(models.Application).order_by(models.Application.created_at.desc()).limit(200).all()
    return [{"id": a.id, "discord": a.discord, "ingame": a.ingame, "main_role": a.main_role, "country": a.country,
             "times": a.times, "experience": a.experience, "why": a.why, "lang": a.lang, "status": a.status,
             "created_at": iso(a.created_at)} for a in apps]


class StatusIn(BaseModel):
    status: str


@router.put("/applications/{aid}")
def set_application_status(aid: int, payload: StatusIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    if payload.status not in ("pending", "accepted", "rejected"):
        raise HTTPException(status_code=400, detail="Bad status")
    a = db.get(models.Application, aid)
    if not a:
        raise HTTPException(status_code=404, detail="Not found")
    a.status, a.decided_by, a.decided_at = payload.status, user.id, datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "status": a.status}


@router.delete("/applications/{aid}")
def delete_application(aid: int, db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    db.query(models.Application).filter(models.Application.id == aid).delete()
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ Ränge & Rollen (Leader / Vice)

@router.get("/admin/users")
def admin_users(db: DbSession = Depends(get_db), user: models.User = Depends(require_admin)):
    users = db.query(models.User).order_by(func.lower(models.User.username)).all()
    return [{"id": u.id, "display_name": u.display_name, "username": u.username, "avatar_url": u.avatar_url,
             "rank": u.rank, "coach_roles": u.coach_list, "rank_manual": u.rank_manual, "in_guild": u.in_guild,
             "last_login_at": iso(u.last_login_at)} for u in users]


class RankIn(BaseModel):
    rank: Optional[str] = None
    coach_roles: Optional[list[str]] = None
    use_discord: Optional[bool] = None


@router.put("/admin/users/{uid}")
def admin_set_rank(uid: int, payload: RankIn, db: DbSession = Depends(get_db), me: models.User = Depends(require_admin)):
    u = db.get(models.User, uid)
    if not u:
        raise HTTPException(status_code=404, detail="Not found")
    # Vice darf weder Leader/Vice vergeben noch Leader/Vice ändern
    if me.rank != "leader" and (u.level >= me.level or (payload.rank and models.RANK_LEVEL.get(payload.rank, 0) >= me.level)):
        raise HTTPException(status_code=403, detail="Only the Leader can change this")
    if payload.use_discord:
        u.rank_manual = False
    else:
        if payload.rank is not None:
            if payload.rank not in models.RANKS:
                raise HTTPException(status_code=400, detail="Bad rank")
            if u.id == me.id and models.RANK_LEVEL[payload.rank] < me.level:
                raise HTTPException(status_code=400, detail="You can't demote yourself")
            u.rank = payload.rank
        if payload.coach_roles is not None:
            u.coach_roles = ",".join(r for r in models.COACH_ROLES if r in payload.coach_roles)
        u.rank_manual = True
    db.commit()
    return {"id": u.id, "rank": u.rank, "coach_roles": u.coach_list, "rank_manual": u.rank_manual}
