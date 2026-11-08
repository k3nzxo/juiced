"""
VOD-Reviews für juiced.team -- Upload in Stücken (fortsetzbar), ffmpeg-Remux, Zeitstempel-Notizen.

Zugriff: Leader und Vice sehen alles, Coaches alle VODs ihrer Rolle, Mitglieder eigene + Team-VODs.
Auslieferung der Dateien: Caddy unter /vods/<datei>, vorher forward_auth auf /api/vods/media-auth (signierte URL).
"""
import hashlib
import hmac
import os
import secrets
import shutil
import subprocess
import threading
import time
import json
from datetime import datetime, timedelta, date, timezone
from typing import Optional, List
from urllib.parse import urlparse, parse_qs

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, Float, BigInteger, Boolean, ForeignKey, func, inspect, text
from sqlalchemy.orm import Session

from . import models, notify
from .config import SECRET_KEY
from .db import Base, engine, get_db, SessionLocal
from .security import require_user

router = APIRouter(prefix="/api/vods", tags=["vods"])

VOD_DIR = os.environ.get("VOD_DIR", "/code/vods")
os.makedirs(VOD_DIR, exist_ok=True)
# Laufende Uploads landen erst auf der schnellen lokalen Platte (nicht auf der Storage Box übers Netz),
# fertige Videos werden danach in einem Rutsch nach VOD_DIR verschoben.
UPLOAD_DIR = os.environ.get("VOD_UPLOAD_DIR", os.path.join(VOD_DIR, ".uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)
GB = 1024 ** 3
MAX_FILE_BYTES = int(float(os.environ.get("VOD_MAX_FILE_GB", "8")) * GB)
MAX_TOTAL_BYTES = int(float(os.environ.get("VOD_MAX_TOTAL_GB", "25")) * GB)
MIN_FREE_BYTES = int(float(os.environ.get("VOD_MIN_FREE_GB", "5")) * GB)  # nie die Platte vollschreiben
RETENTION_DAYS = float(os.environ.get("VOD_RETENTION_DAYS", "14"))       # 0 = nie automatisch löschen
MAX_PER_USER = int(os.environ.get("VOD_MAX_PER_USER", "0"))  # 0 = kein Limit             # gleichzeitige (nicht behaltene) VODs pro Person, Admins ausgenommen
# Liegt VOD_DIR auf der Storage Box, muss dort diese Datei existieren -- fehlt sie, ist die Box nicht eingehängt
# und es wird NICHT auf die Server-Platte geschrieben.
REQUIRE_MARKER = os.environ.get("VOD_REQUIRE_MARKER", "") not in ("", "0", "false")
MARKER_FILE = ".storagebox"
CHUNK_SIZE = 16 * 1024 * 1024  # Stücke werden parallel hochgeladen (Client: 4 gleichzeitig)
MEDIA_URL_TTL = 12 * 3600
ALLOWED_EXT = {".mp4", ".mkv", ".mov", ".webm", ".flv", ".ts", ".m4v"}
VALID_RESULTS = ("win", "loss")
VALID_CATEGORIES = ("good", "mistake", "info", "question")
COACH_ROLES = ("healer", "tank", "nameless", "twinblades")
VOD_ROLES = COACH_ROLES  # (alte Team-VODs bleiben lesbar, neue gibt es nicht mehr)
ROLE_LABELS = {"healer": "Healer", "tank": "Tank", "nameless": "Nameless", "twinblades": "Twinblades", "team": "Team"}


# ---------------------------------------------------------------- Models

class Vod(Base):
    __tablename__ = "vods"
    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    opponent = Column(String, nullable=True)
    match_date = Column(Date, nullable=True)
    result = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    uploader_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    file_key = Column(String, nullable=False, unique=True)
    file_ext = Column(String, nullable=True)        # Endung der fertigen, abspielbaren Datei
    original_filename = Column(String, nullable=True)
    size_bytes = Column(BigInteger, nullable=False, default=0)
    received_bytes = Column(BigInteger, nullable=False, default=0)
    status = Column(String, nullable=False, default="uploading")  # uploading | processing | ready | failed
    error = Column(Text, nullable=True)
    duration_sec = Column(Float, nullable=True)
    has_thumb = Column(Integer, nullable=False, default=0)
    pinned = Column(Boolean, nullable=False, default=False, server_default="false")  # "Behalten": nie automatisch löschen
    role = Column(String, nullable=False, default="team", server_default="team")  # healer | tank | nameless | team
    reviewed_at = Column(DateTime(timezone=True), nullable=True)   # Review vom Coach abgeschlossen
    review_started_at = Column(DateTime(timezone=True), nullable=True)  # Review läuft (Coach hat angefangen)
    review_started_by = Column(Integer, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class VodNote(Base):
    __tablename__ = "vod_notes"
    id = Column(Integer, primary_key=True)
    vod_id = Column(Integer, ForeignKey("vods.id", ondelete="CASCADE"), index=True, nullable=False)
    parent_id = Column(Integer, ForeignKey("vod_notes.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    t_sec = Column(Float, nullable=False, default=0)
    category = Column(String, nullable=False, default="info")
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True)


Base.metadata.create_all(bind=engine, tables=[Vod.__table__, VodNote.__table__])

# Spalten-Migrationen für schon existierende Tabellen (create_all legt keine neuen Spalten an)
_MIGRATIONS = {
    "pinned": "ALTER TABLE vods ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false",
    "role": "ALTER TABLE vods ADD COLUMN role VARCHAR NOT NULL DEFAULT 'team'",
    "reviewed_at": "ALTER TABLE vods ADD COLUMN reviewed_at TIMESTAMP WITH TIME ZONE",
    "reviewed_by": "ALTER TABLE vods ADD COLUMN reviewed_by INTEGER",
    "review_started_at": "ALTER TABLE vods ADD COLUMN review_started_at TIMESTAMP WITH TIME ZONE",
    "review_started_by": "ALTER TABLE vods ADD COLUMN review_started_by INTEGER",
}
try:
    _cols = {c["name"] for c in inspect(engine).get_columns("vods")}
    for _col, _sql in _MIGRATIONS.items():
        if _col not in _cols:
            with engine.begin() as _conn:
                _conn.execute(text(_sql))
            print(f"[vod] Spalte vods.{_col} angelegt")
except Exception as _e:
    print(f"[vod] Migration übersprungen: {_e}")


# ---------------------------------------------------------------- Helpers

_chunk_locks: dict[int, threading.Lock] = {}
_chunk_locks_guard = threading.Lock()


def _chunk_lock(vod_id: int) -> threading.Lock:
    with _chunk_locks_guard:
        return _chunk_locks.setdefault(vod_id, threading.Lock())


def _chunks_path(v: "Vod") -> str:
    return os.path.join(UPLOAD_DIR, f"{v.file_key}.chunks")


def _chunks_total(v: "Vod") -> int:
    return max(1, -(-v.size_bytes // CHUNK_SIZE))


def _chunks_done(v: "Vod") -> list:
    try:
        raw = open(_chunks_path(v), encoding="utf-8").read().strip()
        return sorted({int(x) for x in raw.split(",") if x.strip().isdigit()})
    except FileNotFoundError:
        return []


def _part_path(v: Vod) -> str:
    p = os.path.join(UPLOAD_DIR, f"{v.file_key}.part")
    old = os.path.join(VOD_DIR, f"{v.file_key}.part")  # Uploads von vor der Umstellung
    return old if not os.path.exists(p) and os.path.exists(old) else p


def _final_name(v: Vod) -> str:
    return f"{v.file_key}{v.file_ext or '.mp4'}"


def _thumb_name(v: Vod) -> str:
    return f"{v.file_key}.jpg"


def _sign(name: str, exp: int) -> str:
    return hmac.new(SECRET_KEY.encode(), f"vod:{name}:{exp}".encode(), hashlib.sha256).hexdigest()[:40]


def _media_url(name: str) -> str:
    # Auf volle 6h runden, damit der Browser die Datei zwischen zwei Seitenaufrufen cachen kann
    exp = (int(time.time()) // 21600 + 3) * 21600
    return f"/vods/{name}?exp={exp}&sig={_sign(name, exp)}"


class VodCtx:
    """Wer fragt an und was darf er (admin | coach | member)."""
    def __init__(self, user: models.User, level: str, roles: set):
        self.user, self.level, self.roles = user, level, roles

    @property
    def is_admin(self) -> bool:
        return self.level == "admin"

    @property
    def is_coach(self) -> bool:
        return self.level in ("admin", "coach")


def _ctx_for(db: Session, user: models.User) -> Optional[VodCtx]:
    # Leader und Vice sehen alles; Coaches ihre Rollen; Mitglieder eigene + Team-VODs
    if user.level >= models.RANK_LEVEL["vice"]:
        return VodCtx(user, "admin", set(COACH_ROLES))
    if user.level < models.RANK_LEVEL["member"]:
        return None
    roles = set(user.coach_list)
    return VodCtx(user, "coach" if roles else "member", roles)


def vod_ctx(db: Session = Depends(get_db), user: models.User = Depends(require_user)) -> VodCtx:
    ctx = _ctx_for(db, user)
    if not ctx:
        raise HTTPException(status_code=403, detail="Members only")
    return ctx


def _can_view(v: Vod, ctx: VodCtx) -> bool:
    return bool(ctx.is_admin or v.uploader_id == ctx.user.id or v.role == "team" or v.role in ctx.roles)


def _can_edit(v: Vod, ctx: VodCtx) -> bool:
    """Bearbeiten / Behalten / Löschen: Uploader, Admin, Coaches der Rolle (Team-VODs: alle Coaches)."""
    return bool(ctx.is_admin or v.uploader_id == ctx.user.id or v.role in ctx.roles
                or (v.role == "team" and ctx.level == "coach"))


def _can_review(v: "Vod", ctx: "VodCtx") -> bool:
    """Review abschließen: Coaches der Rolle sowie Leader/Vice."""
    return bool(ctx.is_admin or v.role in ctx.roles)


def _get_vod(db: Session, vod_id: int) -> Vod:
    v = db.query(Vod).filter(Vod.id == vod_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="VOD nicht gefunden")
    return v


def _used_bytes(db: Session) -> int:
    return int(db.query(func.coalesce(func.sum(Vod.size_bytes), 0)).filter(Vod.status != "failed").scalar() or 0)


def _delete_files(v: Vod):
    names = (f"{v.file_key}.part", f"{v.file_key}.chunks", _final_name(v), _thumb_name(v), f"{v.file_key}.remux.mp4")
    for folder in (VOD_DIR, UPLOAD_DIR):
        for name in names:
            try:
                os.remove(os.path.join(folder, name))
            except FileNotFoundError:
                pass
            except Exception as e:
                print(f"[vod] Konnte {name} nicht löschen: {e}")


def _storage_ok() -> bool:
    return (not REQUIRE_MARKER) or os.path.exists(os.path.join(VOD_DIR, MARKER_FILE))


def _require_storage():
    if not _storage_ok():
        raise HTTPException(status_code=503, detail="VOD-Speicher (Storage Box) ist gerade nicht verbunden -- bitte Admin Bescheid geben")


def _expires_at(v: Vod):
    if v.pinned or RETENTION_DAYS <= 0 or not v.created_at or v.status in ("uploading", "processing"):
        return None
    return v.created_at + timedelta(days=RETENTION_DAYS)


def _cleanup_stale(db: Session):
    """Abgebrochene Uploads (48h ohne Fortschritt) und abgelaufene, nicht behaltene VODs wegräumen."""
    if not _storage_ok():
        return  # Box nicht da -> lieber nichts anfassen
    cutoff = datetime.utcnow() - timedelta(hours=48)
    stale = db.query(Vod).filter(Vod.status == "uploading", Vod.updated_at < cutoff).all()
    if RETENTION_DAYS > 0:
        old = datetime.utcnow() - timedelta(days=RETENTION_DAYS)
        stale += db.query(Vod).filter(Vod.status.in_(("ready", "failed")), Vod.pinned == False,  # noqa: E712
                                      Vod.created_at < old).all()
    for v in stale:
        print(f"[vod] Lösche VOD {v.id} ({v.title}, Status {v.status})")
    for v in stale:
        _delete_files(v)
        db.delete(v)
    if stale:
        db.commit()


# ---------------------------------------------------------------- Verarbeitung (ffmpeg)

def _probe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        raise RuntimeError(f"ffprobe: {out.stderr.strip()[-400:]}")
    return json.loads(out.stdout or "{}")


def _run_ffmpeg(args: List[str], timeout: int = 3600) -> subprocess.CompletedProcess:
    return subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
                          capture_output=True, text=True, timeout=timeout)


_processing_lock = threading.Lock()  # immer nur ein ffmpeg gleichzeitig (nur 2 CPUs auf dem Server)


def _process_vod(vod_id: int):
    with _processing_lock:
        db = SessionLocal()
        try:
            v = db.query(Vod).filter(Vod.id == vod_id).first()
            if not v or v.status != "processing":
                return
            src = _part_path(v)
            try:
                info = _probe(src)
                streams = info.get("streams", [])
                vstreams = [s for s in streams if s.get("codec_type") == "video"]
                if not vstreams:
                    raise RuntimeError("Keine Videospur in der Datei gefunden")
                vcodec = vstreams[0].get("codec_name", "")
                fmt = (info.get("format", {}) or {}).get("format_name", "")
                duration = float((info.get("format", {}) or {}).get("duration") or 0) or None
                acodecs = [s.get("codec_name", "") for s in streams if s.get("codec_type") == "audio"]

                browser_ok_audio = all(a in ("aac", "mp3", "opus", "vorbis") for a in acodecs)
                is_mp4 = "mp4" in fmt or "mov" in fmt
                is_webm = (v.original_filename or "").lower().endswith(".webm") and vcodec in ("vp8", "vp9", "av1") \
                    and all(a in ("opus", "vorbis") for a in acodecs)

                if is_webm:
                    v.file_ext = ".webm"
                    shutil.move(src, os.path.join(VOD_DIR, _final_name(v)))
                else:
                    v.file_ext = ".mp4"
                    dst = os.path.join(VOD_DIR, _final_name(v))
                    tmp = os.path.join(UPLOAD_DIR, f"{v.file_key}.remux.mp4")  # lokal remuxen, dann einmal verschieben
                    # Immer remuxen (auch MP4): verschiebt den moov-Atom nach vorne (faststart) -> sofortiges Abspielen/Spulen.
                    # Video wird NIE neu encodiert (würde auf 2 CPUs ewig dauern), Audio nur falls der Browser es nicht kann.
                    acodec_args = ["-c:a", "copy"] if browser_ok_audio else ["-c:a", "aac", "-b:a", "160k"]
                    res = _run_ffmpeg(["-i", src, "-map", "0:v:0", "-map", "0:a?", "-c:v", "copy", *acodec_args,
                                       "-movflags", "+faststart", tmp])
                    if res.returncode != 0 and acodec_args[1] == "copy":
                        res = _run_ffmpeg(["-i", src, "-map", "0:v:0", "-map", "0:a?", "-c:v", "copy",
                                           "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp])
                    if res.returncode != 0:
                        if is_mp4:
                            # Remux fehlgeschlagen, aber MP4 spielt der Browser trotzdem meist ab
                            shutil.move(src, dst)
                            try: os.remove(tmp)
                            except FileNotFoundError: pass
                        else:
                            raise RuntimeError(f"ffmpeg: {res.stderr.strip()[-400:]}")
                    else:
                        shutil.move(tmp, dst)
                        os.remove(src)

                final = os.path.join(VOD_DIR, _final_name(v))
                v.size_bytes = os.path.getsize(final)
                v.duration_sec = duration
                if vcodec not in ("h264", "vp9", "av1", "vp8"):
                    v.error = f"Hinweis: Video-Codec '{vcodec}' wird evtl. nicht von jedem Browser abgespielt (am besten in OBS H.264/x264 aufnehmen)."
                ss = max(1.0, (duration or 20) * 0.15)
                th = _run_ffmpeg(["-ss", f"{ss:.1f}", "-i", final, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4",
                                  os.path.join(VOD_DIR, _thumb_name(v))], timeout=120)
                v.has_thumb = 1 if th.returncode == 0 else 0
                v.status = "ready"
            except Exception as e:
                print(f"[vod] Verarbeitung von VOD {vod_id} fehlgeschlagen: {e}")
                v.status = "failed"
                v.error = str(e)[:1000]
                _delete_files(v)  # Rohdatei weg, sonst belegt sie unsichtbar Platz
            db.commit()
        finally:
            db.close()


def _start_processing(vod_id: int):
    threading.Thread(target=_process_vod, args=(vod_id,), daemon=True).start()


def _resume_processing_on_startup():
    db = SessionLocal()
    try:
        for (vid,) in db.query(Vod.id).filter(Vod.status == "processing").all():
            _start_processing(vid)
    finally:
        db.close()


try:
    _resume_processing_on_startup()
except Exception as e:  # DB beim Start evtl. noch nicht bereit -- nicht die ganze App crashen lassen
    print(f"[vod] resume beim Start übersprungen: {e}")


def _cleanup_loop():
    while True:
        time.sleep(30 * 60)
        db = SessionLocal()
        try:
            _cleanup_stale(db)
        except Exception as e:
            print(f"[vod] Aufräumen fehlgeschlagen: {e}")
            db.rollback()
        finally:
            db.close()


threading.Thread(target=_cleanup_loop, daemon=True).start()


# ---------------------------------------------------------------- Schemas

class VodCreateIn(BaseModel):
    title: str
    role: Optional[str] = None
    opponent: Optional[str] = None
    match_date: Optional[date] = None
    result: Optional[str] = None
    description: Optional[str] = None
    filename: str
    size_bytes: int


class VodUpdateIn(BaseModel):
    title: Optional[str] = None
    role: Optional[str] = None
    opponent: Optional[str] = None
    match_date: Optional[date] = None
    result: Optional[str] = None
    description: Optional[str] = None


class PinIn(BaseModel):
    pinned: bool


class NoteIn(BaseModel):
    t_sec: float = 0
    category: str = "info"
    text: str
    parent_id: Optional[int] = None


class NoteUpdateIn(BaseModel):
    text: Optional[str] = None
    category: Optional[str] = None
    t_sec: Optional[float] = None


def _vod_out(v: Vod, users: dict, note_count: int, ctx: VodCtx) -> dict:
    return {
        "id": v.id, "title": v.title, "role": v.role, "opponent": v.opponent,
        "match_date": v.match_date.isoformat() if v.match_date else None,
        "result": v.result, "description": v.description,
        "uploader_id": v.uploader_id, "uploader_name": users.get(v.uploader_id),
        "original_filename": v.original_filename,
        "size_bytes": v.size_bytes, "received_bytes": v.received_bytes,
        "status": v.status, "error": v.error, "duration_sec": v.duration_sec,
        "note_count": note_count,
        "pinned": bool(v.pinned),
        "reviewed": bool(v.reviewed_at),
        "reviewed_at": v.reviewed_at.isoformat() if v.reviewed_at else None,
        "reviewed_by_name": users.get(v.reviewed_by),
        "in_review": bool(v.review_started_at and not v.reviewed_at),
        "review_started_by_name": users.get(v.review_started_by),
        "can_review": _can_review(v, ctx),
        "expires_at": (lambda e: e.isoformat() if e else None)(_expires_at(v)),
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "can_edit": _can_edit(v, ctx),
        "thumb_url": _media_url(_thumb_name(v)) if v.has_thumb else None,
        "video_url": _media_url(_final_name(v)) if v.status == "ready" else None,
    }


def _note_out(n: VodNote, users: dict, ctx: VodCtx) -> dict:
    return {
        "id": n.id, "vod_id": n.vod_id, "parent_id": n.parent_id, "t_sec": n.t_sec,
        "category": n.category, "text": n.text,
        "user_id": n.user_id, "user_name": users.get(n.user_id),
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "edited": bool(n.updated_at),
        "can_edit": bool(ctx.is_admin or (n.user_id and n.user_id == ctx.user.id)),
    }


def _users_map(db: Session) -> dict:
    return {u.id: u.display_name for u in db.query(models.User).all()}


def _clean(s: Optional[str], max_len: int) -> Optional[str]:
    s = (s or "").strip()
    return s[:max_len] or None


def _get_visible_vod(db: Session, vod_id: int, ctx: VodCtx) -> Vod:
    v = _get_vod(db, vod_id)
    if not _can_view(v, ctx):
        raise HTTPException(status_code=404, detail="VOD nicht gefunden")  # 404 statt 403: nichts verraten
    return v


# ---------------------------------------------------------------- Benachrichtigungen

def _notify(db: Session, user_ids, title: str, body: str, vod_id: int):
    """Discord-DM an die Empfänger, Link jeweils in deren Sprache."""
    ids = list({i for i in user_ids if i})
    if not ids:
        return
    for u in db.query(models.User).filter(models.User.id.in_(ids)).all():
        notify.dm([u.discord_id], title, body, f"/{u.lang or 'en'}/app/#/vods/{vod_id}")


def _coach_ids_for(db: Session, role: str) -> List[int]:
    if role not in COACH_ROLES:
        return []
    return [u.id for u in db.query(models.User).filter(models.User.rank != "guest").all() if role in u.coach_list]


# ---------------------------------------------------------------- Caddy forward_auth

@router.get("/media-auth")
def media_auth(request: Request):
    """Wird von Caddy vor jeder /vods/<datei>-Auslieferung aufgerufen (forward_auth)."""
    fwd = request.headers.get("x-forwarded-uri", "")
    parsed = urlparse(fwd)
    name = parsed.path.rsplit("/", 1)[-1]
    q = parse_qs(parsed.query)
    try:
        exp = int(q.get("exp", ["0"])[0])
    except ValueError:
        exp = 0
    sig = q.get("sig", [""])[0]
    if not name or "/" in name or name.startswith(".") or exp < time.time():
        raise HTTPException(status_code=403, detail="Link abgelaufen")
    if not hmac.compare_digest(sig, _sign(name, exp)):
        raise HTTPException(status_code=403, detail="Ungültiger Link")
    return {"ok": True}


# ---------------------------------------------------------------- VOD-Endpunkte

@router.get("/storage")
def storage_info(db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    du = shutil.disk_usage(VOD_DIR)
    return {"used_bytes": _used_bytes(db), "limit_bytes": MAX_TOTAL_BYTES,
            "max_file_bytes": MAX_FILE_BYTES, "disk_free_bytes": du.free,
            "retention_days": int(RETENTION_DAYS) if float(RETENTION_DAYS).is_integer() else RETENTION_DAYS,
            "max_per_user": MAX_PER_USER, "storage_ok": _storage_ok()}


@router.get("")
def list_vods(db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    _cleanup_stale(db)
    vods = db.query(Vod).order_by(Vod.match_date.desc().nullslast(), Vod.created_at.desc()).all()
    counts = dict(db.query(VodNote.vod_id, func.count(VodNote.id)).group_by(VodNote.vod_id).all())
    users = _users_map(db)
    return [_vod_out(v, users, counts.get(v.id, 0), ctx) for v in vods
            if _can_view(v, ctx) and (v.status != "uploading" or v.uploader_id == ctx.user.id)]


@router.post("")
def create_vod(payload: VodCreateIn, db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    _require_storage()
    user = ctx.user
    title = _clean(payload.title, 200)
    if not title:
        raise HTTPException(status_code=400, detail="Titel fehlt")
    if payload.role not in VOD_ROLES:
        raise HTTPException(status_code=400, detail="Please pick a role (Healer, Tank or Nameless)")
    if payload.role == "team" and not ctx.is_coach:
        raise HTTPException(status_code=403, detail="Team-VODs können nur Coaches hochladen")
    if MAX_PER_USER > 0 and not ctx.is_coach:
        mine = db.query(func.count(Vod.id)).filter(Vod.uploader_id == user.id, Vod.pinned == False,  # noqa: E712
                                                   Vod.status != "failed").scalar() or 0
        if mine >= MAX_PER_USER:
            raise HTTPException(status_code=400, detail=f"Du hast schon {mine} VODs hochgeladen (max. {MAX_PER_USER}) -- lösch erst ein altes")
    ext = os.path.splitext(payload.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Dateityp {ext or '?'} nicht erlaubt (erlaubt: {', '.join(sorted(ALLOWED_EXT))})")
    if payload.size_bytes <= 0:
        raise HTTPException(status_code=400, detail="Leere Datei")
    if payload.size_bytes > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail=f"Datei zu groß (max. {MAX_FILE_BYTES / GB:.0f} GB)")
    used = _used_bytes(db)
    if used + payload.size_bytes > MAX_TOTAL_BYTES:
        raise HTTPException(status_code=400, detail=f"VOD-Speicher voll ({used / GB:.1f} / {MAX_TOTAL_BYTES / GB:.0f} GB) -- alte VODs löschen")
    if shutil.disk_usage(VOD_DIR).free - payload.size_bytes < MIN_FREE_BYTES:
        raise HTTPException(status_code=400, detail="Not enough free storage")
    if shutil.disk_usage(UPLOAD_DIR).free - payload.size_bytes * 2 < MIN_FREE_BYTES:
        raise HTTPException(status_code=400, detail="Not enough free space for uploads right now, try again later")
    result = payload.result if payload.result in VALID_RESULTS else None
    v = Vod(
        title=title, role=payload.role, opponent=_clean(payload.opponent, 120), match_date=payload.match_date, result=result,
        description=_clean(payload.description, 5000), uploader_id=user.id,
        file_key=secrets.token_hex(16), original_filename=_clean(payload.filename, 255),
        size_bytes=payload.size_bytes, received_bytes=0, status="uploading",
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    with open(_part_path(v), "wb") as f:  # Datei in voller Größe anlegen, Stücke landen an ihrer Position
        f.truncate(v.size_bytes)
    out = _vod_out(v, _users_map(db), 0, ctx)
    out["chunk_size"] = CHUNK_SIZE
    return out


@router.put("/{vod_id}/chunk")
async def upload_chunk(vod_id: int, index: int, request: Request, db: Session = Depends(get_db),
                       ctx: VodCtx = Depends(vod_ctx)):
    """Ein Stück (index) hochladen. Stücke dürfen parallel und in beliebiger Reihenfolge kommen."""
    v = _get_vod(db, vod_id)
    if v.uploader_id != ctx.user.id:
        raise HTTPException(status_code=403, detail="Only the uploader can upload")
    if v.status != "uploading":
        raise HTTPException(status_code=409, detail="Upload already finished")
    _require_storage()
    total = _chunks_total(v)
    if index < 0 or index >= total:
        raise HTTPException(status_code=400, detail="Bad chunk index")
    start = index * CHUNK_SIZE
    expected = min(CHUNK_SIZE, v.size_bytes - start)
    buf = bytearray()
    async for part in request.stream():
        buf += part
        if len(buf) > expected:
            raise HTTPException(status_code=400, detail="Chunk too large")
    if len(buf) != expected:
        raise HTTPException(status_code=400, detail="Chunk incomplete")
    part = _part_path(v)

    def _write() -> set:
        # läuft in einem Hilfs-Thread: parallele Stücke blockieren sich nicht gegenseitig
        with open(part, "r+b") as f:
            f.seek(start)
            f.write(buf)
        with _chunk_lock(v.id):
            got = set(_chunks_done(v))
            got.add(index)
            with open(_chunks_path(v), "w", encoding="utf-8") as f:
                f.write(",".join(str(x) for x in sorted(got)))
        return got

    try:
        done = await run_in_threadpool(_write)
    except FileNotFoundError:
        raise HTTPException(status_code=410, detail="Upload was cancelled")
    v.received_bytes = min(v.size_bytes, len(done) * CHUNK_SIZE)
    db.commit()
    return {"done": len(done), "total": total}


@router.post("/{vod_id}/complete")
def complete_upload(vod_id: int, db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    v = _get_vod(db, vod_id)
    if v.uploader_id != ctx.user.id:
        raise HTTPException(status_code=403, detail="Nur der Uploader kann den Upload abschließen")
    if v.status != "uploading":
        return _vod_out(v, _users_map(db), 0, ctx)
    missing = set(range(_chunks_total(v))) - set(_chunks_done(v))
    if missing:
        raise HTTPException(status_code=400, detail=f"Upload incomplete ({len(missing)} parts missing)")
    try:
        os.remove(_chunks_path(v))
    except FileNotFoundError:
        pass
    v.status = "processing"
    db.commit()
    _start_processing(v.id)
    if v.role in COACH_ROLES:
        _notify(db, [i for i in _coach_ids_for(db, v.role) if i != ctx.user.id],
                f"New {ROLE_LABELS[v.role]} VOD", f"{ctx.user.display_name} uploaded \"{v.title}\" for review.", v.id)
    return _vod_out(v, _users_map(db), 0, ctx)


@router.get("/{vod_id}")
def get_vod(vod_id: int, db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    v = _get_visible_vod(db, vod_id, ctx)
    users = _users_map(db)
    notes = db.query(VodNote).filter(VodNote.vod_id == v.id).order_by(VodNote.t_sec, VodNote.created_at).all()
    out = _vod_out(v, users, len(notes), ctx)
    out["notes"] = [_note_out(n, users, ctx) for n in notes]
    out["chunk_size"] = CHUNK_SIZE
    if v.status == "uploading":
        out["chunks_done"] = _chunks_done(v)
    return out


@router.put("/{vod_id}")
def update_vod(vod_id: int, payload: VodUpdateIn, db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    v = _get_visible_vod(db, vod_id, ctx)
    if not _can_edit(v, ctx):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    data = payload.model_dump(exclude_unset=True)
    if "title" in data:
        title = _clean(data["title"], 200)
        if not title:
            raise HTTPException(status_code=400, detail="Titel fehlt")
        v.title = title
    if data.get("role") in VOD_ROLES:
        if data["role"] == "team" and not ctx.is_coach:
            raise HTTPException(status_code=403, detail="Team-VODs können nur Coaches anlegen")
        v.role = data["role"]
    if "opponent" in data:
        v.opponent = _clean(data["opponent"], 120)
    if "match_date" in data:
        v.match_date = data["match_date"]
    if "result" in data:
        v.result = data["result"] if data["result"] in VALID_RESULTS else None
    if "description" in data:
        v.description = _clean(data["description"], 5000)
    db.commit()
    return _vod_out(v, _users_map(db), 0, ctx)


@router.put("/{vod_id}/pin")
def pin_vod(vod_id: int, payload: PinIn, db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    v = _get_visible_vod(db, vod_id, ctx)
    if not _can_edit(v, ctx):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    v.pinned = bool(payload.pinned)
    db.commit()
    return _vod_out(v, _users_map(db), 0, ctx)


class ReviewedIn(BaseModel):
    reviewed: bool


@router.put("/{vod_id}/reviewed")
def set_reviewed(vod_id: int, payload: ReviewedIn, db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    """Review als abgeschlossen markieren (oder wieder öffnen). Uploader bekommt eine Discord-Nachricht."""
    v = _get_visible_vod(db, vod_id, ctx)
    if not _can_review(v, ctx):
        raise HTTPException(status_code=403, detail="Only coaches of this role can do that")
    was = bool(v.reviewed_at)
    if payload.reviewed:
        v.reviewed_at, v.reviewed_by = v.reviewed_at or datetime.now(timezone.utc), v.reviewed_by or ctx.user.id
    else:
        v.reviewed_at, v.reviewed_by = None, None
        v.review_started_at, v.review_started_by = None, None
    db.commit()
    if payload.reviewed and not was and v.uploader_id and v.uploader_id != ctx.user.id:
        _notify(db, [v.uploader_id], "Your VOD has been reviewed",
                f"{ctx.user.display_name} finished the review of \"{v.title}\".", v.id)
    return _vod_out(v, _users_map(db), 0, ctx)


class ReviewingIn(BaseModel):
    reviewing: bool


@router.put("/{vod_id}/reviewing")
def set_reviewing(vod_id: int, payload: ReviewingIn, db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    """Review starten (Status "In Review") oder wieder auf "Offen" setzen."""
    v = _get_visible_vod(db, vod_id, ctx)
    if not _can_review(v, ctx):
        raise HTTPException(status_code=403, detail="Only coaches of this role can do that")
    started = _start_review(v, ctx) if payload.reviewing else False
    if not payload.reviewing:
        v.review_started_at, v.review_started_by = None, None
    db.commit()
    if started and v.uploader_id and v.uploader_id != ctx.user.id:
        _notify(db, [v.uploader_id], "Your VOD is being reviewed",
                f"{ctx.user.display_name} started the review of \"{v.title}\".", v.id)
    return _vod_out(v, _users_map(db), 0, ctx)


def _start_review(v, ctx) -> bool:
    """Setzt "In Review", falls noch nicht begonnen/abgeschlossen. True = gerade gestartet."""
    if v.review_started_at or v.reviewed_at:
        return False
    v.review_started_at, v.review_started_by = datetime.now(timezone.utc), ctx.user.id
    return True


@router.delete("/{vod_id}")
def delete_vod(vod_id: int, db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    v = _get_visible_vod(db, vod_id, ctx)
    if not _can_edit(v, ctx):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    if v.status == "processing":
        raise HTTPException(status_code=409, detail="VOD wird gerade verarbeitet -- gleich nochmal versuchen")
    _delete_files(v)
    db.delete(v)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- Notizen

@router.post("/{vod_id}/notes")
def add_note(vod_id: int, payload: NoteIn, db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    v = _get_visible_vod(db, vod_id, ctx)
    text_ = _clean(payload.text, 4000)
    if not text_:
        raise HTTPException(status_code=400, detail="Text fehlt")
    parent = None
    if payload.parent_id:
        parent = db.query(VodNote).filter(VodNote.id == payload.parent_id, VodNote.vod_id == v.id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Notiz nicht gefunden")
        if parent.parent_id:  # nur eine Antwort-Ebene
            parent = db.query(VodNote).filter(VodNote.id == parent.parent_id).first()
    # Uploader benachrichtigen, wenn jemand Neues anfängt, sein VOD zu kommentieren (nicht bei jeder Notiz)
    first_from_user = bool(v.uploader_id and v.uploader_id != ctx.user.id and not db.query(VodNote.id).filter(
        VodNote.vod_id == v.id, VodNote.user_id == ctx.user.id).first())
    n = VodNote(
        vod_id=v.id, parent_id=parent.id if parent else None, user_id=ctx.user.id,
        t_sec=parent.t_sec if parent else max(0.0, float(payload.t_sec or 0)),
        category=(parent.category if parent else (payload.category if payload.category in VALID_CATEGORIES else "info")),
        text=text_,
    )
    db.add(n)
    if v.uploader_id != ctx.user.id and _can_review(v, ctx):
        _start_review(v, ctx)
    db.commit()
    db.refresh(n)
    if first_from_user:
        _notify(db, [v.uploader_id], "Your VOD is being reviewed",
                f"{ctx.user.display_name} started commenting on \"{v.title}\".", v.id)
    return _note_out(n, _users_map(db), ctx)


@router.put("/{vod_id}/notes/{note_id}")
def update_note(vod_id: int, note_id: int, payload: NoteUpdateIn, db: Session = Depends(get_db),
                ctx: VodCtx = Depends(vod_ctx)):
    _get_visible_vod(db, vod_id, ctx)
    n = db.query(VodNote).filter(VodNote.id == note_id, VodNote.vod_id == vod_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notiz nicht gefunden")
    if not (ctx.is_admin or n.user_id == ctx.user.id):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    if payload.text is not None:
        text_ = _clean(payload.text, 4000)
        if not text_:
            raise HTTPException(status_code=400, detail="Text fehlt")
        n.text = text_
    if payload.category in VALID_CATEGORIES and not n.parent_id:
        n.category = payload.category
    if payload.t_sec is not None and not n.parent_id:
        n.t_sec = max(0.0, float(payload.t_sec))
    n.updated_at = datetime.utcnow()
    db.commit()
    return _note_out(n, _users_map(db), ctx)


@router.delete("/{vod_id}/notes/{note_id}")
def delete_note(vod_id: int, note_id: int, db: Session = Depends(get_db), ctx: VodCtx = Depends(vod_ctx)):
    v = _get_visible_vod(db, vod_id, ctx)
    n = db.query(VodNote).filter(VodNote.id == note_id, VodNote.vod_id == vod_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notiz nicht gefunden")
    # eigene Notizen; Admin und Coaches der Rolle dürfen aufräumen
    if not (ctx.is_admin or n.user_id == ctx.user.id or v.role in ctx.roles):
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    db.delete(n)
    db.commit()
    return {"ok": True}
