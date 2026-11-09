"""Sessions, Rechte-Checks, CSRF-Schutz (Origin-Prüfung) und einfaches Rate-Limiting."""
import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session as DbSession
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from . import models
from .config import OWNER_DISCORD_IDS, PUBLIC_URL, SECRET_KEY, SESSION_COOKIE, SESSION_DAYS, IS_PROD
from .db import get_db


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def sign(value: str) -> str:
    mac = hmac.new(SECRET_KEY.encode(), value.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{value}.{mac}"


def unsign(signed: str) -> str | None:
    if not signed or "." not in signed:
        return None
    value, mac = signed.rsplit(".", 1)
    good = hmac.new(SECRET_KEY.encode(), value.encode(), hashlib.sha256).hexdigest()[:32]
    return value if hmac.compare_digest(mac, good) else None


def create_session(db: DbSession, user: models.User) -> str:
    token = secrets.token_urlsafe(32)
    db.add(models.Session(id=_hash(token), user_id=user.id,
                          expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)))
    db.commit()
    return token


def set_session_cookie(response, token: str):
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True,
                        secure=IS_PROD, samesite="lax", path="/")


def destroy_session(db: DbSession, token: str | None):
    if token:
        db.query(models.Session).filter(models.Session.id == _hash(token)).delete()
        db.commit()


def current_user_optional(request: Request, db: DbSession = Depends(get_db)) -> models.User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    s = db.query(models.Session).filter(models.Session.id == _hash(token)).first()
    if not s:
        return None
    exp = s.expires_at if s.expires_at.tzinfo else s.expires_at.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        db.delete(s)
        db.commit()
        return None
    user = db.query(models.User).filter(models.User.id == s.user_id).first()
    # Owner ist immer Developer, auch wenn der Rang mal manuell geändert wurde
    if user and user.discord_id in OWNER_DISCORD_IDS and user.rank != "developer":
        user.rank = "developer"
    # Lese-Transaktion beenden -> Verbindung geht sofort zurück in den Pool. Sonst hielte jede Anfrage eine
    # Verbindung, auch während sie auf Raid-Helper/Discord wartet, und bei vielen Besuchern wäre der Pool voll.
    db.commit()
    return user


def require_user(user: models.User | None = Depends(current_user_optional)) -> models.User:
    if not user:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


def require_member(user: models.User = Depends(require_user)) -> models.User:
    if user.level < models.RANK_LEVEL["member"]:
        raise HTTPException(status_code=403, detail="Members only")
    return user


def require_management(user: models.User = Depends(require_user)) -> models.User:
    # früher eigener Rang "Management" -- jetzt erledigen das Leader und Vice
    if user.level < models.RANK_LEVEL["vice"]:
        raise HTTPException(status_code=403, detail="Leader / Vice only")
    return user


def require_staff(user: models.User = Depends(require_user)) -> models.User:
    """Nur ansehen: Admin, Vice, Leader, Developer."""
    if user.level < models.RANK_LEVEL["admin"]:
        raise HTTPException(status_code=403, detail="Staff only")
    return user


def require_admin(user: models.User = Depends(require_user)) -> models.User:
    if user.level < models.RANK_LEVEL["vice"]:
        raise HTTPException(status_code=403, detail="Leader / Vice only")
    return user


class OriginCheckMiddleware(BaseHTTPMiddleware):
    """CSRF-Schutz: verändernde Requests müssen von der eigenen Seite kommen."""

    SAFE = {"GET", "HEAD", "OPTIONS"}

    async def dispatch(self, request: Request, call_next):
        if request.method not in self.SAFE and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin") or ""
            referer = request.headers.get("referer") or ""
            ok = origin == PUBLIC_URL or (not origin and referer.startswith(PUBLIC_URL + "/"))
            if not ok:
                return JSONResponse({"detail": "Bad origin"}, status_code=403)
        return await call_next(request)


class RateLimiter:
    """Sehr einfaches In-Memory-Limit pro Schlüssel (reicht für einen einzelnen Prozess)."""

    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, per_seconds: int):
        now = time.time()
        with self._lock:
            q = self._hits[key]
            while q and q[0] < now - per_seconds:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(status_code=429, detail="Too many requests — try again later")
            q.append(now)


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "?"))
