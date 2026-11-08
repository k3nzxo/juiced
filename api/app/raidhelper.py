"""Raid-Helper: kommende Events des Discord-Servers samt Anmeldungen (nur für Mitglieder).
Der API-Schlüssel steht nur in der .env (RAIDHELPER_API_KEY) und verlässt den Server nie."""
import threading
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends

from . import models
from .config import DISCORD_GUILD_ID, _env
from .security import require_member

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


def _signup(s: dict) -> dict:
    cls = str(s.get("className") or s.get("roleName") or "").strip()
    return {
        "name": str(s.get("name") or "")[:64],
        "user_id": str(s.get("userId") or ""),
        "class": cls[:40],
        "spec": str(s.get("specName") or "").strip()[:40],
        "role": str(s.get("roleName") or "").strip()[:40],
        "status": str(s.get("status") or "primary").lower(),
        "playing": cls.lower() not in NOT_PLAYING and str(s.get("status") or "primary").lower() == "primary",
        "position": s.get("position") or s.get("entryTime") or 0,
    }


def _event(e: dict) -> dict:
    signups = [_signup(s) for s in (e.get("signUps") or []) if isinstance(s, dict)]
    signups.sort(key=lambda x: (x["position"] if isinstance(x["position"], (int, float)) else 0))
    channel = str(e.get("channelId") or "")
    eid = str(e.get("id") or "")
    return {
        "id": eid,
        "title": str(e.get("title") or e.get("displayTitle") or "Event")[:120],
        "description": str(e.get("description") or "")[:500],
        "start": _ts(e.get("startTime")),
        "end": _ts(e.get("endTime")),
        "leader": str(e.get("leaderName") or "")[:64],
        "signups": signups,
        "count": sum(1 for s in signups if s["playing"]),
        "url": f"https://discord.com/channels/{SERVER_ID}/{channel}/{eid}" if channel and eid and SERVER_ID else None,
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
    return {"configured": True, "events": [ev for _, ev in out[:20]]}


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


@router.get("/events")
def events(user: models.User = Depends(require_member)):
    data = get_events()
    # eigene Anmeldung markieren
    mine = str(user.discord_id or "")
    return {**data, "events": [{**e, "me": next((s for s in e["signups"] if s["user_id"] == mine), None)}
                               for e in data.get("events", [])]}
