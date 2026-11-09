from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from .config import DATABASE_URL

_kwargs = {"pool_pre_ping": True}
# Reserve für viele gleichzeitige Anfragen (Postgres erlaubt 100 Verbindungen); nach 10 s Warten lieber Fehler
_kwargs.update(pool_size=10, max_overflow=20, pool_timeout=10)
if DATABASE_URL.startswith("sqlite"):  # lokal/Tests: gleiche Pool-Größe wie auf dem Server
    _kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **_kwargs)
# expire_on_commit=False: nach commit() bleiben geladene Werte nutzbar, ohne die Verbindung neu zu holen
# (wichtig, damit die Login-Prüfung ihre Verbindung sofort zurückgeben kann, siehe security.current_user_optional)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
