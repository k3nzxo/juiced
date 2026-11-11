"""Aktivitätsprotokoll für den Developer: wer hat wann was auf der Seite gemacht.

Erfasst werden alle verändernden API-Aufrufe (POST/PUT/PATCH/DELETE) und Logins -- keine reinen Seitenaufrufe.
Upload-Stücke (/chunk) werden ausgelassen (ein VOD wären Hunderte Einträge); der Upload selbst steht als
"VOD upload started" / "VOD upload finished" drin. Einträge älter als LOG_KEEP_DAYS werden gelöscht.
"""
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session as DbSession
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware

from . import models
from .config import SESSION_COOKIE, _env
from .db import SessionLocal, get_db
from .security import _hash, require_user

LOG_KEEP_DAYS = int(_env("LOG_KEEP_DAYS", "30") or 30)
WRITE = {"POST", "PUT", "PATCH", "DELETE"}

# (Methode, Pfad-Muster, Beschreibung) -- erste passende Zeile gewinnt
_N = r"[^/]+"
LABELS = [
    ("POST", r"/api/auth/logout", "Signed out"),
    ("PUT", r"/api/me", "Saved own profile"),
    ("PUT", rf"/api/members/{_N}/build", "Edited a member's build"),
    ("PUT", rf"/api/members/{_N}/partners", "Edited a member's partners"),
    ("PUT", rf"/api/admin/users/{_N}", "Changed a member's rank / settings"),
    ("POST", r"/api/announcements", "Posted an announcement"),
    ("PUT", rf"/api/announcements/{_N}", "Edited an announcement"),
    ("DELETE", rf"/api/announcements/{_N}", "Deleted an announcement"),
    ("POST", r"/api/applications", "Sent an application"),
    ("PUT", rf"/api/applications/{_N}", "Handled an application"),
    ("DELETE", rf"/api/applications/{_N}", "Deleted an application"),
    ("POST", r"/api/events", "Added a schedule entry"),
    ("PUT", rf"/api/events/{_N}", "Edited a schedule entry"),
    ("DELETE", rf"/api/events/{_N}", "Deleted a schedule entry"),
    ("POST", r"/api/scrims", "Sent a match request"),
    ("PUT", rf"/api/scrims/{_N}", "Answered a match request"),
    ("DELETE", rf"/api/scrims/{_N}", "Deleted a match request"),
    ("POST", r"/api/vods", "VOD upload started"),
    ("POST", rf"/api/vods/{_N}/complete", "VOD upload finished"),
    ("PUT", rf"/api/vods/{_N}/pin", "Kept / unkept a VOD"),
    ("PUT", rf"/api/vods/{_N}/reviewed", "Marked a VOD reviewed / reopened"),
    ("PUT", rf"/api/vods/{_N}/reviewing", "Started / stopped a VOD review"),
    ("POST", rf"/api/vods/{_N}/notes", "Commented on a VOD"),
    ("PUT", rf"/api/vods/{_N}/notes/{_N}", "Edited a VOD comment"),
    ("DELETE", rf"/api/vods/{_N}/notes/{_N}", "Deleted a VOD comment"),
    ("PUT", rf"/api/vods/{_N}", "Edited a VOD"),
    ("DELETE", rf"/api/vods/{_N}", "Deleted a VOD"),
    ("PUT", rf"/api/raidhelper/rosters/{_N}/push", "Sent a roster to Raid-Helper"),
    ("POST", rf"/api/raidhelper/rosters/{_N}/push", "Sent a roster to Raid-Helper"),
    ("PUT", rf"/api/raidhelper/rosters/{_N}", "Saved a raid roster"),
    ("POST", r"/api/raidhelper/events", "Created a Raid-Helper event"),
    ("POST", rf"/api/raidhelper/events/{_N}/remind", "Reminded unsigned members"),
    ("POST", rf"/api/raidhelper/events/{_N}/cancel", "Cancelled a raid"),
    ("POST", rf"/api/raidhelper/events/{_N}/restore", "Restored a raid"),
    ("DELETE", rf"/api/raidhelper/events/{_N}", "Deleted a raid"),
    ("PUT", r"/api/raidhelper/partnerships", "Saved the partnership list"),
    ("POST", r"/api/raidhelper/partnerships/check", None),  # nur Vorschau beim Tippen -> nicht protokollieren
]
_COMPILED = [(m, re.compile(p + r"/?$"), label) for m, p, label in LABELS]


def label_for(method: str, path: str) -> tuple[bool, str]:
    """(protokollieren?, Beschreibung)"""
    for m, rx, label in _COMPILED:
        if m == method and rx.fullmatch(path):
            return label is not None, label or ""
    return True, f"{method} {path}"  # unbekannt: trotzdem festhalten, roh


def add(db: DbSession, user_id: Optional[int], action: str, method: str = "", path: str = "", status: int = 200):
    db.add(models.ActivityLog(user_id=user_id, action=action[:120], method=method[:8], path=path[:200], status=status))
    if random.random() < 0.02:  # ab und zu alte Einträge wegräumen
        cutoff = datetime.now(timezone.utc) - timedelta(days=LOG_KEEP_DAYS)
        db.query(models.ActivityLog).filter(models.ActivityLog.at < cutoff).delete(synchronize_session=False)
    db.commit()


def _user_id_for(token: Optional[str]) -> Optional[int]:
    if not token:
        return None
    db = SessionLocal()
    try:
        s = db.query(models.Session).filter(models.Session.id == _hash(token)).first()
        return s.user_id if s else None
    finally:
        db.close()


def _write(user_id, action, method, path, status):
    db = SessionLocal()
    try:
        add(db, user_id, action, method, path, status)
    except Exception as ex:  # Protokoll darf nie die eigentliche Aktion stören
        print(f"[log] nicht gespeichert: {type(ex).__name__}")
        db.rollback()
    finally:
        db.close()


class ActivityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        method, path = request.method, request.url.path
        if method not in WRITE or not path.startswith("/api/") or path.endswith("/chunk"):
            return await call_next(request)
        keep, action = label_for(method, path)
        if not keep:
            return await call_next(request)
        # Person VOR der Aktion bestimmen (nach "Abmelden" gäbe es die Sitzung nicht mehr)
        uid = await run_in_threadpool(_user_id_for, request.cookies.get(SESSION_COOKIE))
        response = await call_next(request)
        await run_in_threadpool(_write, uid, action, method, path, response.status_code)
        return response


# ---------------------------------------------------------------- Abruf (nur Developer)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_developer(user: models.User = Depends(require_user)) -> models.User:
    if user.rank != "developer":
        raise HTTPException(status_code=403, detail="Developer only")
    return user


@router.get("/logs")
def logs(before: Optional[int] = None, user_id: Optional[int] = None, errors: bool = False, q: str = "",
         db: DbSession = Depends(get_db), user: models.User = Depends(require_developer)):
    query = db.query(models.ActivityLog)
    if before:
        query = query.filter(models.ActivityLog.id < before)
    if user_id:
        query = query.filter(models.ActivityLog.user_id == user_id)
    if errors:
        query = query.filter(models.ActivityLog.status >= 400)
    q = (q or "").strip()[:60]
    if q:
        like = f"%{q}%"
        query = query.filter(models.ActivityLog.action.ilike(like) | models.ActivityLog.path.ilike(like))
    rows = query.order_by(models.ActivityLog.id.desc()).limit(150).all()
    ids = {r.user_id for r in rows if r.user_id}
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(ids)).all()} if ids else {}

    def who(uid):
        u = users.get(uid)
        return {"id": u.id, "name": u.display_name, "avatar_url": u.avatar_url, "rank": u.rank} if u else None

    def iso(at):  # SQLite (lokal) speichert ohne Zeitzone -> als UTC kennzeichnen
        return (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).isoformat() if at else None

    return {"items": [{"id": r.id, "at": iso(r.at), "user": who(r.user_id), "action": r.action,
                       "method": r.method, "path": r.path, "status": r.status} for r in rows],
            "more": len(rows) == 150, "keep_days": LOG_KEEP_DAYS}
