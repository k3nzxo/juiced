import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from fastapi.responses import FileResponse

from . import appimages, models, notify
from .auth import user_out
from .db import get_db
from .security import client_ip, current_user_optional, limiter, require_admin, require_management, require_member, require_user

router = APIRouter(prefix="/api", tags=["site"])
LANGS = {"en", "de", "fr", "es", "pt", "ru", "tr", "pl"}
RANK_ORDER = {"developer": 0, "leader": 1, "vice": 2, "coach": 3, "member": 4}


def clean_links(links) -> list:
    """Nur echte http(s)-Links, max. 5, je max. 300 Zeichen."""
    out = []
    for raw in (links or [])[:5]:
        u = (raw or "").strip()
        if not u:
            continue
        if len(u) > 300 or not u.startswith(("https://", "http://")) or any(c in u for c in ' <>"\''):
            raise HTTPException(status_code=400, detail="Invalid link")
        out.append(u)
    return out


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
    users.sort(key=lambda u: (RANK_ORDER.get(u.public_rank, 9), u.display_name.lower()))
    return {"members": [{
        "display_name": u.display_name, "avatar_url": u.avatar_url, "rank": u.public_rank,
        "coach_roles": u.coach_list, "main_role": u.main_role, "weapons": u.weapon_list, "weapon_other": u.weapon_other,
        "country": u.country,
    } for u in users]}


class ApplicationIn(BaseModel):
    discord: str
    ingame: str
    main_role: str
    weapons: list[str] = []
    weapon_other: Optional[str] = None
    build: Optional[str] = None
    build_link: Optional[str] = None
    inner_ways: Optional[str] = None
    build_images: list[str] = []
    region: Optional[str] = None
    gear_score: Optional[int] = None
    arena_rank: Optional[str] = None
    country: str
    times: Optional[str] = None
    experience: str
    why: Optional[str] = None
    lang: Optional[str] = None
    platforms: list[str] = []
    vod_links: list[str] = []
    website: Optional[str] = None  # Honeypot


@router.post("/applications")
def apply(payload: ApplicationIn, request: Request, db: DbSession = Depends(get_db)):
    ip = client_ip(request)
    limiter.check("apply:" + ip, 3, 3600)
    if payload.website:  # Bot -> so tun, als wäre alles gut
        return {"ok": True}
    fields = dict(discord=clean(payload.discord, 64), ingame=clean(payload.ingame, 64), country=clean(payload.country, 64),
                  experience=clean(payload.experience, 2000))
    platforms = [p for p in models.PLATFORMS if p in (payload.platforms or [])]
    links = clean_links(payload.vod_links)
    weapons, weapon_other = models.clean_weapons(payload.weapons, payload.main_role), clean(payload.weapon_other, 40)
    if not all(fields.values()) or payload.main_role not in models.MAIN_ROLES or not platforms or not links:
        raise HTTPException(status_code=400, detail="Missing fields")
    if not (weapons or weapon_other):  # Waffe ist bei jeder Rolle Pflicht
        raise HTTPException(status_code=400, detail="Missing weapon")
    build = clean(payload.build, 2000)
    build_link = (clean_links([payload.build_link]) or [None])[0] if payload.build_link else None
    inner_ways = clean(payload.inner_ways, 500)
    # wie im alten Discord-Ticket: Region, Gear Score und Screenshots sind Pflicht
    if payload.region not in models.REGIONS:
        raise HTTPException(status_code=400, detail="Missing region")
    if not payload.gear_score or not (1 <= payload.gear_score <= 999999):
        raise HTTPException(status_code=400, detail="Missing gear score")
    if not payload.build_images:
        raise HTTPException(status_code=400, detail="Missing screenshots")
    images = appimages.save_images(payload.build_images)
    a = models.Application(**fields, times=clean(payload.times, 120) or "", main_role=payload.main_role, weapons=weapons or None, weapon_other=weapon_other,
                           build=build, build_link=build_link, inner_ways=inner_ways, build_images=json.dumps(images),
                           region=payload.region, gear_score=payload.gear_score, arena_rank=clean(payload.arena_rank, 40),
                           why=clean(payload.why, 2000),
                           lang=payload.lang if payload.lang in LANGS else None,
                           platforms=",".join(platforms), vod_links=json.dumps(links))
    db.add(a)
    try:
        db.commit()
    except Exception:
        appimages.delete_images(images)
        raise
    notify.application_webhook(a)
    return {"ok": True}


# ------------------------------------------------------------------ eigenes Profil

class ProfileIn(BaseModel):
    ingame_name: Optional[str] = None
    main_role: Optional[str] = None
    weapons: Optional[list[str]] = None
    weapon_other: Optional[str] = None
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
    if "weapons" in data:
        user.weapons = models.clean_weapons(data["weapons"], user.main_role) or None
    if "weapon_other" in data:
        user.weapon_other = clean(data["weapon_other"], 40)
    if not user.main_role:
        user.weapons, user.weapon_other = None, None
    elif user.weapons:  # nach Rollenwechsel nur passende Waffen behalten
        user.weapons = models.clean_weapons(user.weapons.split(","), user.main_role) or None
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
    users.sort(key=lambda u: (RANK_ORDER.get(u.public_rank, 9), u.display_name.lower()))
    return [{"id": u.id, "display_name": u.display_name, "username": u.username, "avatar_url": u.avatar_url,
             "rank": u.public_rank, "coach_roles": u.coach_list, "main_role": u.main_role, "weapons": u.weapon_list,
             "weapon_other": u.weapon_other, "country": u.country, "last_login_at": iso(u.last_login_at)} for u in users]


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

def _app_images(a: models.Application) -> list[str]:
    try:
        return [n for n in json.loads(a.build_images or "[]") if isinstance(n, str)]
    except ValueError:
        return []


def _cleanup_applications(db: DbSession):
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    old = db.query(models.Application).filter(models.Application.status != "pending", models.Application.decided_at < cutoff).all()
    for a in old:
        appimages.delete_images(_app_images(a))
        db.delete(a)
    db.commit()


@router.get("/applications/images/{name}")
def application_image(name: str, user: models.User = Depends(require_management)):
    """Build-Screenshots nur für Leader/Vice."""
    return FileResponse(appimages.image_path(name), media_type="image/jpeg",
                        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})


@router.get("/applications")
def list_applications(db: DbSession = Depends(get_db), user: models.User = Depends(require_management)):
    _cleanup_applications(db)
    apps = db.query(models.Application).order_by(models.Application.created_at.desc()).limit(200).all()
    return [{"id": a.id, "discord": a.discord, "ingame": a.ingame, "main_role": a.main_role,
             "weapons": [w for w in (a.weapons or "").split(",") if w], "weapon_other": a.weapon_other,
             "build": a.build, "build_link": a.build_link, "inner_ways": a.inner_ways,
             "region": a.region, "gear_score": a.gear_score, "arena_rank": a.arena_rank,
             "build_images": [f"/api/applications/images/{n}" for n in _app_images(a)], "country": a.country,
             "times": a.times, "experience": a.experience, "why": a.why, "lang": a.lang, "status": a.status,
             "platforms": [p for p in (a.platforms or "").split(",") if p], "vod_links": json.loads(a.vod_links or "[]"),
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
    a = db.get(models.Application, aid)
    if a:
        appimages.delete_images(_app_images(a))
        db.delete(a)
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


def _can_assign(me: models.User, target: models.User, new_rank: Optional[str]) -> bool:
    """Developer darf alles. Leader: alle unter sich, bis Leader vergeben. Vice: nur bis Mitglied."""
    if me.rank == "developer":
        return True
    if target.id != me.id and target.level >= me.level:
        return False
    if new_rank is None:
        return True
    lvl = models.RANK_LEVEL.get(new_rank, 0)
    if me.rank == "leader":
        return lvl <= models.RANK_LEVEL["leader"]
    return lvl < me.level


@router.put("/admin/users/{uid}")
def admin_set_rank(uid: int, payload: RankIn, db: DbSession = Depends(get_db), me: models.User = Depends(require_admin)):
    u = db.get(models.User, uid)
    if not u:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_assign(me, u, payload.rank):
        raise HTTPException(status_code=403, detail="Not allowed")
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


# ------------------------------------------------------------------ Wochenplan

class EventIn(BaseModel):
    title: str
    kind: str = "other"
    starts_at: datetime
    duration_min: int = 90
    opponent: Optional[str] = None
    description: Optional[str] = None
    repeat_weekly: bool = False
    repeat_days: Optional[str] = None  # z. B. "0123456" = täglich, "4" = jeden Freitag
    open_end: bool = False
    is_public: bool = True


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# Wiederholungen laufen in Gildenzeit, damit 20:00 auch nach der Zeitumstellung 20:00 bleibt
EVENT_TZ = ZoneInfo(os.environ.get("EVENT_TZ", "Europe/Berlin"))


def _repeat_days(e: models.Event) -> str:
    """Effektive Wochentage; alte 'wöchentlich'-Termine nehmen den Wochentag ihres Starts."""
    if e.repeat_days:
        return e.repeat_days
    if e.repeat_weekly:
        return str(_aware(e.starts_at).astimezone(EVENT_TZ).weekday())
    return ""


def _event_out(e: models.Event, start: datetime, can_edit: bool) -> dict:
    return {"id": e.id, "title": e.title, "kind": e.kind, "starts_at": iso(start),
            "ends_at": iso(start + timedelta(minutes=e.duration_min)), "duration_min": e.duration_min,
            "opponent": e.opponent, "description": e.description, "repeat_weekly": bool(_repeat_days(e)), "repeat_days": _repeat_days(e), "open_end": bool(e.open_end),
            "is_public": e.is_public, "first_start": iso(e.starts_at), "can_edit": can_edit}


@router.get("/events")
def list_events(start: datetime, end: datetime, db: DbSession = Depends(get_db),
                user: Optional[models.User] = Depends(current_user_optional)):
    """Termine im Zeitraum, wöchentliche werden aufgefächert. Gäste sehen nur öffentliche Termine."""
    start, end = _aware(start), _aware(end)
    if end <= start or end - start > timedelta(days=62):
        raise HTTPException(status_code=400, detail="Bad range")
    member = bool(user and user.level >= models.RANK_LEVEL["member"])
    can_edit = bool(user and user.level >= models.RANK_LEVEL["vice"])
    q = db.query(models.Event).filter(models.Event.starts_at < end)
    if not member:
        q = q.filter(models.Event.is_public == True)  # noqa: E712
    out = []
    for e in q.all():
        first = _aware(e.starts_at)
        dur = timedelta(minutes=e.duration_min)
        days = _repeat_days(e)
        if not days:
            if first + dur > start:
                out.append(_event_out(e, first, can_edit))
            continue
        local = first.astimezone(EVENT_TZ)
        day = max(local.date(), (start - dur).astimezone(EVENT_TZ).date() - timedelta(days=1))
        last = end.astimezone(EVENT_TZ).date()
        while day <= last:
            if str(day.weekday()) in days:
                t = datetime.combine(day, local.timetz().replace(tzinfo=None), EVENT_TZ).astimezone(timezone.utc)
                if first <= t < end and t + dur > start:
                    out.append(_event_out(e, t, can_edit))
            day += timedelta(days=1)
    out.sort(key=lambda x: x["starts_at"])
    return out


def _validate_event(p: EventIn) -> dict:
    title = clean(p.title, 120)
    days = "".join(sorted({c for c in (p.repeat_days or "") if c in "0123456"}))
    if p.repeat_days is None and p.repeat_weekly:  # ältere Clients
        days = str(_aware(p.starts_at).astimezone(EVENT_TZ).weekday())
    if not title or p.kind not in models.EVENT_KINDS or not (10 <= p.duration_min <= 24 * 60):
        raise HTTPException(status_code=400, detail="Missing fields")
    return dict(title=title, kind=p.kind, starts_at=_aware(p.starts_at).astimezone(timezone.utc), duration_min=p.duration_min,
                opponent=clean(p.opponent, 80), description=clean(p.description, 2000),
                repeat_weekly=bool(days), repeat_days=days or None, open_end=p.open_end, is_public=p.is_public)


@router.post("/events")
def create_event(payload: EventIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_admin)):
    e = models.Event(**_validate_event(payload), created_by=user.id)
    db.add(e)
    db.commit()
    db.refresh(e)
    return _event_out(e, _aware(e.starts_at), True)


@router.put("/events/{eid}")
def update_event(eid: int, payload: EventIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_admin)):
    e = db.get(models.Event, eid)
    if not e:
        raise HTTPException(status_code=404, detail="Not found")
    for k, v in _validate_event(payload).items():
        setattr(e, k, v)
    db.commit()
    return _event_out(e, _aware(e.starts_at), True)


@router.delete("/events/{eid}")
def delete_event(eid: int, db: DbSession = Depends(get_db), user: models.User = Depends(require_admin)):
    db.query(models.Event).filter(models.Event.id == eid).delete()
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ Match-Anfragen anderer Gilden

class ScrimIn(BaseModel):
    guild_name: str
    contact: str
    server: Optional[str] = None
    format: Optional[str] = None
    proposed_times: str
    message: Optional[str] = None
    website: Optional[str] = None  # Honeypot


@router.post("/scrims")
def request_scrim(payload: ScrimIn, request: Request, db: DbSession = Depends(get_db)):
    limiter.check("scrim:" + client_ip(request), 3, 3600)
    if payload.website:
        return {"ok": True}
    guild, contact, times = clean(payload.guild_name, 80), clean(payload.contact, 64), clean(payload.proposed_times, 300)
    if not guild or not contact or not times:
        raise HTTPException(status_code=400, detail="Missing fields")
    r = models.ScrimRequest(guild_name=guild, contact=contact, server=clean(payload.server, 80),
                            format=clean(payload.format, 60), proposed_times=times, message=clean(payload.message, 2000),
                            token=secrets.token_urlsafe(18))
    db.add(r)
    db.commit()
    notify.scrim_webhook(r)
    return {"ok": True, "token": r.token}


@router.get("/scrims/status/{token}")
def scrim_status(token: str, request: Request, db: DbSession = Depends(get_db)):
    """Öffentlicher Status einer Anfrage, nur mit dem geheimen Link abrufbar."""
    limiter.check("scrimstatus:" + client_ip(request), 60, 600)
    r = db.query(models.ScrimRequest).filter(models.ScrimRequest.token == token).first() if len(token) >= 16 else None
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    return {"guild_name": r.guild_name, "status": r.status, "reply": r.reply, "proposed_times": r.proposed_times,
            "created_at": iso(r.created_at), "decided_at": iso(r.decided_at)}


@router.get("/scrims")
def list_scrims(db: DbSession = Depends(get_db), user: models.User = Depends(require_admin)):
    cutoff = datetime.now(timezone.utc) - timedelta(days=60)
    db.query(models.ScrimRequest).filter(models.ScrimRequest.status != "pending", models.ScrimRequest.decided_at < cutoff).delete()
    db.commit()
    items = db.query(models.ScrimRequest).order_by(models.ScrimRequest.created_at.desc()).limit(200).all()
    return [{"id": r.id, "guild_name": r.guild_name, "contact": r.contact, "server": r.server, "format": r.format,
             "proposed_times": r.proposed_times, "message": r.message, "status": r.status, "reply": r.reply,
             "created_at": iso(r.created_at)} for r in items]


class ScrimStatusIn(BaseModel):
    status: str
    reply: Optional[str] = None


@router.put("/scrims/{rid}")
def set_scrim_status(rid: int, payload: ScrimStatusIn, db: DbSession = Depends(get_db), user: models.User = Depends(require_admin)):
    if payload.status not in ("pending", "accepted", "declined"):
        raise HTTPException(status_code=400, detail="Bad status")
    r = db.get(models.ScrimRequest, rid)
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    r.status, r.decided_by, r.decided_at = payload.status, user.id, datetime.now(timezone.utc)
    if payload.reply is not None:
        r.reply = clean(payload.reply, 1000)
    db.commit()
    return {"ok": True}


@router.delete("/scrims/{rid}")
def delete_scrim(rid: int, db: DbSession = Depends(get_db), user: models.User = Depends(require_admin)):
    db.query(models.ScrimRequest).filter(models.ScrimRequest.id == rid).delete()
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ Benachrichtigungen (Glocke)

@router.get("/notifications")
def notifications(db: DbSession = Depends(get_db), user: Optional[models.User] = Depends(current_user_optional)):
    """Offene Punkte für den eingeloggten Nutzer: Bewerbungen + Match-Anfragen (Leader/Vice),
    VODs der eigenen Coach-Rollen ohne Notiz."""
    out = {"applications": 0, "matches": 0, "vods": 0}
    if not user or user.level < models.RANK_LEVEL["member"]:
        return {**out, "total": 0}
    if user.level >= models.RANK_LEVEL["vice"]:
        out["applications"] = db.query(models.Application).filter(models.Application.status == "pending").count()
        out["matches"] = db.query(models.ScrimRequest).filter(models.ScrimRequest.status == "pending").count()
    roles = list(models.COACH_ROLES) if user.level >= models.RANK_LEVEL["vice"] else user.coach_list
    if roles:
        from .vods import Vod, VodNote
        reviewed = {vid for (vid,) in db.query(VodNote.vod_id).distinct().all()}
        out["vods"] = sum(1 for (vid,) in db.query(Vod.id).filter(Vod.status == "ready", Vod.role.in_(roles),
                                                                    Vod.uploader_id != user.id).all() if vid not in reviewed)
    return {**out, "total": sum(out.values())}
