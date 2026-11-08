from datetime import datetime, timezone

from fastapi import FastAPI

from . import models  # noqa: F401  (Tabellen registrieren)
from .auth import router as auth_router
from .config import IS_PROD
from .db import Base, SessionLocal, engine
from .routes import router as site_router
from .security import OriginCheckMiddleware

Base.metadata.create_all(bind=engine)
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
