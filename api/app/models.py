from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, func

from .db import Base

# Ränge (aufsteigend). "Coach" ist kein eigener Rang, sondern ergibt sich aus coach_roles.
RANKS = ("guest", "member", "vice", "leader", "developer")
RANK_LEVEL = {r: i for i, r in enumerate(RANKS)}
COACH_ROLES = ("healer", "tank", "nameless")
MAIN_ROLES = ("healer", "tank", "nameless")


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    discord_id = Column(String, unique=True, nullable=False, index=True)
    username = Column(String, nullable=False)
    global_name = Column(String, nullable=True)
    avatar_hash = Column(String, nullable=True)
    rank = Column(String, nullable=False, default="guest")
    coach_roles = Column(String, nullable=False, default="")       # "healer,tank"
    rank_manual = Column(Boolean, nullable=False, default=False)    # True = nicht mehr aus Discord überschreiben
    in_guild = Column(Boolean, nullable=False, default=False)
    ingame_name = Column(String, nullable=True)
    main_role = Column(String, nullable=True)
    country = Column(String(2), nullable=True)
    show_on_team = Column(Boolean, nullable=False, default=True)
    lang = Column(String(5), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    @property
    def coach_list(self) -> list[str]:
        return [r for r in (self.coach_roles or "").split(",") if r in COACH_ROLES]

    @property
    def level(self) -> int:
        return RANK_LEVEL.get(self.rank or "guest", 0)

    @property
    def display_name(self) -> str:
        return self.ingame_name or self.global_name or self.username

    @property
    def avatar_url(self) -> str | None:
        if not self.avatar_hash:
            return None
        ext = "gif" if self.avatar_hash.startswith("a_") else "png"
        return f"https://cdn.discordapp.com/avatars/{self.discord_id}/{self.avatar_hash}.{ext}?size=128"

    @property
    def public_rank(self) -> str:
        if self.rank in ("developer", "leader", "vice"):
            return self.rank
        if self.coach_list and self.level >= 1:
            return "coach"
        return self.rank


class Session(Base):
    __tablename__ = "sessions"
    id = Column(String(64), primary_key=True)  # sha256 des Cookie-Werts
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)


class Announcement(Base):
    __tablename__ = "announcements"
    id = Column(Integer, primary_key=True)
    title = Column(String(160), nullable=False)
    body = Column(Text, nullable=False)
    pinned = Column(Boolean, nullable=False, default=False)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True)


class Application(Base):
    __tablename__ = "applications"
    id = Column(Integer, primary_key=True)
    discord = Column(String(64), nullable=False)
    ingame = Column(String(64), nullable=False)
    main_role = Column(String(16), nullable=False)
    country = Column(String(64), nullable=False)
    times = Column(String(120), nullable=False)
    experience = Column(Text, nullable=False)
    why = Column(Text, nullable=True)
    lang = Column(String(5), nullable=True)
    platforms = Column(String(40), nullable=True)   # "pc,ps,mobile"
    vod_links = Column(Text, nullable=True)         # JSON-Liste mit URLs
    status = Column(String(12), nullable=False, default="pending")  # pending | accepted | rejected
    decided_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


EVENT_KINDS = ("gvg", "raid", "scrim", "ingame", "friday", "other")
PLATFORMS = ("pc", "ps", "mobile")


class Event(Base):
    """Eintrag im Wochenplan. repeat_weekly = gleicher Wochentag/Uhrzeit jede Woche."""
    __tablename__ = "events"
    id = Column(Integer, primary_key=True)
    title = Column(String(120), nullable=False)
    kind = Column(String(12), nullable=False, default="other")
    starts_at = Column(DateTime(timezone=True), nullable=False, index=True)
    duration_min = Column(Integer, nullable=False, default=90)
    opponent = Column(String(80), nullable=True)
    description = Column(Text, nullable=True)
    repeat_weekly = Column(Boolean, nullable=False, default=False)
    repeat_days = Column(String(7), nullable=True)  # Wochentage der Wiederholung, Mo=0 ... So=6 (Gildenzeit)
    open_end = Column(Boolean, nullable=False, default=False)   # z. B. Friday Night: Beginn bekannt, Ende offen
    is_public = Column(Boolean, nullable=False, default=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ScrimRequest(Base):
    """Anfrage einer anderen Gilde für ein Custom Game."""
    __tablename__ = "scrim_requests"
    id = Column(Integer, primary_key=True)
    guild_name = Column(String(80), nullable=False)
    contact = Column(String(64), nullable=False)
    server = Column(String(80), nullable=True)
    format = Column(String(60), nullable=True)
    proposed_times = Column(String(300), nullable=False)
    message = Column(Text, nullable=True)
    status = Column(String(12), nullable=False, default="pending")  # pending | accepted | declined
    token = Column(String(40), nullable=True, index=True)  # privater Status-Link für die anfragende Gilde
    reply = Column(Text, nullable=True)                    # Antwort der Leitung, sichtbar über den Status-Link
    decided_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
