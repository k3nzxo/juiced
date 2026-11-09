from datetime import datetime, timezone

from fastapi import FastAPI

from . import models  # noqa: F401  (Tabellen registrieren)
from .auth import router as auth_router
from .config import IS_PROD
from .db import Base, SessionLocal, engine
from .routes import router as site_router
from .security import OriginCheckMiddleware

Base.metadata.create_all(bind=engine)


def _add_missing_columns():
    """Neue Spalten in bestehenden Tabellen ergänzen (create_all macht das nicht)."""
    from sqlalchemy import inspect, text
    wanted = {
        "applications": {"platforms": "VARCHAR(40)", "vod_links": "TEXT", "weapons": "VARCHAR(80)", "weapon_other": "VARCHAR(40)",
                         "build": "TEXT", "build_link": "VARCHAR(300)", "inner_ways": "TEXT", "build_images": "TEXT",
                         "region": "VARCHAR(8)", "gear_score": "INTEGER", "arena_rank": "VARCHAR(40)"},
        "users": {"weapons": "VARCHAR(80)", "weapon_other": "VARCHAR(40)", "main_path": "VARCHAR(32)", "alt_paths": "VARCHAR(240)",
                  "inner_ways": "VARCHAR(900)", "partners": "VARCHAR(400)",
                  "main_build": "VARCHAR(80)", "alt_builds": "VARCHAR(400)", "dm_off": "VARCHAR(200)"},
        "events": {"open_end": "BOOLEAN NOT NULL DEFAULT false", "repeat_days": "VARCHAR(7)"},
        "scrim_requests": {"token": "VARCHAR(40)", "reply": "TEXT"},
    }
    insp = inspect(engine)
    for table, cols in wanted.items():
        have = {c["name"] for c in insp.get_columns(table)}
        for col, typ in cols.items():
            if col not in have:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {typ}"))
                print(f"[db] {table}.{col} angelegt")
    # Pfade -> Builds (zwei Waffen): bestehende Profile einmalig übernehmen
    from .wwm import PATH_WEAPONS, build_id
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, main_path, alt_paths FROM users WHERE main_build IS NULL AND "
                                 "(main_path IS NOT NULL OR alt_paths IS NOT NULL)")).fetchall()
        for uid, mp, ap in rows:
            mb = build_id(*PATH_WEAPONS[mp]) if mp in PATH_WEAPONS else None
            alts = [build_id(*PATH_WEAPONS[p]) for p in (ap or "").split(",") if p in PATH_WEAPONS]
            conn.execute(text("UPDATE users SET main_build = :mb, alt_builds = :ab WHERE id = :id"),
                         {"mb": mb, "ab": ",".join(alts) or None, "id": uid})
        if rows:
            print(f"[db] {len(rows)} Profile von Pfaden auf Builds umgestellt")
    # Früher waren Nameless/Twinblades Hauptrollen, jetzt: Rolle DPS + Waffe
    with engine.begin() as conn:
        for table in ("users", "applications"):
            n = conn.execute(text(f"UPDATE {table} SET weapons = main_role, main_role = 'dps' "
                                  f"WHERE main_role IN ('nameless', 'twinblades')")).rowcount
            if n:
                print(f"[db] {table}: {n} Einträge auf DPS + Waffe umgestellt")
        # alte Waffen-Schlüssel (nameless, twinblades) auf die echten Waffennamen umstellen
        from .models import OLD_WEAPONS
        for table in ("users", "applications"):
            rows = conn.execute(text(f"SELECT id, weapons FROM {table} WHERE weapons IS NOT NULL AND weapons <> ''")).fetchall()
            for rid, w in rows:
                new = ",".join(dict.fromkeys(OLD_WEAPONS.get(x, x) for x in w.split(",") if x))
                if new != w:
                    conn.execute(text(f"UPDATE {table} SET weapons = :w WHERE id = :id"), {"w": new, "id": rid})


_add_missing_columns()
from .vods import router as vods_router  # noqa: E402  (legt VOD-Tabellen selbst an)

app = FastAPI(
    title="juiced.team API",
    docs_url=None if IS_PROD else "/api/docs",
    redoc_url=None,
    openapi_url=None if IS_PROD else "/api/openapi.json",
)
app.add_middleware(OriginCheckMiddleware)
# Fehler als Code + englischer Text, die Website übersetzt den Code
from fastapi.exceptions import HTTPException as _HTTPException  # noqa: E402
from starlette.exceptions import HTTPException as _StarletteHTTPException  # noqa: E402
from .errors import http_exception_handler  # noqa: E402
app.add_exception_handler(_HTTPException, http_exception_handler)
app.add_exception_handler(_StarletteHTTPException, http_exception_handler)
app.include_router(auth_router)
app.include_router(site_router)
app.include_router(vods_router)
from .raidhelper import router as raidhelper_router  # noqa: E402
app.include_router(raidhelper_router)


@app.get("/api/health")
def health():
    """Für die Überwachung: API läuft UND die Datenbank antwortet."""
    from fastapi.responses import JSONResponse
    from sqlalchemy import text
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as ex:
        return JSONResponse({"ok": False, "db": type(ex).__name__}, status_code=503)
    return {"ok": True}


@app.on_event("startup")
def _purge_sessions():
    db = SessionLocal()
    try:
        db.query(models.Session).filter(models.Session.expires_at < datetime.now(timezone.utc)).delete()
        db.commit()
    finally:
        db.close()
