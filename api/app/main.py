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
    wanted = {"applications": {"platforms": "VARCHAR(40)", "vod_links": "TEXT"}}
    insp = inspect(engine)
    for table, cols in wanted.items():
        have = {c["name"] for c in insp.get_columns(table)}
        for col, typ in cols.items():
            if col not in have:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {typ}"))
                print(f"[db] {table}.{col} angelegt")


_add_missing_columns()
from .vods import router as vods_router  # noqa: E402  (legt VOD-Tabellen selbst an)

app = FastAPI(
    title="juiced.team API",
    docs_url=None if IS_PROD else "/api/docs",
    redoc_url=None,
    openapi_url=None if IS_PROD else "/api/openapi.json",
)
app.add_middleware(OriginCheckMiddleware)
app.include_router(auth_router)
app.include_router(site_router)
app.include_router(vods_router)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.on_event("startup")
def _purge_sessions():
    db = SessionLocal()
    try:
        db.query(models.Session).filter(models.Session.expires_at < datetime.now(timezone.utc)).delete()
        db.commit()
    finally:
        db.close()
