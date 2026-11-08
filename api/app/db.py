from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from .config import DATABASE_URL

_kwargs = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    _kwargs["connect_args"] = {"check_same_thread": False}
else:
    # Reserve für viele gleichzeitige Anfragen (Postgres erlaubt 100 Verbindungen); nach 10 s Warten lieber Fehler
    _kwargs.update(pool_size=10, max_overflow=20, pool_timeout=10)

engine = create_engine(DATABASE_URL, **_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
