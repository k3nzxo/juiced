from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, func

from .db import Base

# Ränge (aufsteigend). "Coach" ist kein eigener Rang, sondern ergibt sich aus coach_roles.
# "admin": sieht alles (Bewerbungen, Match-Anfragen, Wochenplan, Ränge, alle VODs), darf aber nichts ändern
RANKS = ("guest", "member", "admin", "vice", "leader", "developer")
RANK_LEVEL = {r: i for i, r in enumerate(RANKS)}
COACH_ROLES = ("healer", "tank", "nameless", "twinblades")  # Twinblades: Waffe, eigener Coach
MAIN_ROLES = ("healer", "tank", "dps")
# Waffen (Kampfstile) aus Where Winds Meet, je Hauptrolle; weitere per Freitext (weapon_other)
WEAPONS_BY_ROLE = {
    "dps": ("nameless_sword", "strategic_sword", "nameless_spear", "heavenquaker_spear", "infernal_twinblades", "riven_twinblades",
            "inkwell_fan", "vernal_umbrella", "everspring_umbrella", "mortal_rope_dart", "unfettered_rope_dart", "skygrasp_rope_dart",
            "heavenwill_gauntlets", "skystrike_gauntlets", "snowparting_blade", "phalanxbane_blade", "ninefold_umbrella"),
    "tank": ("stormbreaker_spear", "thundercry_blade"),
    "healer": ("panacea_fan", "soulshade_umbrella", "willowbend_fan", "ribbon_drum"),
}
WEAPONS = tuple(w for ws in WEAPONS_BY_ROLE.values() for w in ws)
OLD_WEAPONS = {"nameless": "nameless_sword", "twinblades": "infernal_twinblades"}


def clean_weapons(items, role=None) -> str:
    """Nur bekannte Waffen; mit Rolle nur die Waffen dieser Rolle."""
    allowed = WEAPONS_BY_ROLE.get(role, ()) if role else WEAPONS
    return ",".join(w for w in allowed if w in (items or []))


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
    weapons = Column(String(80), nullable=True)        # "nameless,twinblades"
    weapon_other = Column(String(40), nullable=True)   # freie Angabe
    main_path = Column(String(32), nullable=True)      # Haupt-Pfad (Waffenpaar), siehe wwm.py
    alt_paths = Column(String(240), nullable=True)     # weitere spielbare Pfade, kommagetrennt
    inner_ways = Column(String(900), nullable=True)    # gewählte Inner Ways, kommagetrennt
    partners = Column(String(400), nullable=True)      # Ingame-Partner (Discord-IDs), kommagetrennt
    main_build = Column(String(80), nullable=True)     # Haupt-Build: zwei Waffen "a+b" (auch Hybride)
    alt_builds = Column(String(400), nullable=True)    # weitere Builds, kommagetrennt
    country = Column(String(2), nullable=True)
    show_on_team = Column(Boolean, nullable=False, default=True)
    lang = Column(String(5), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    @property
    def weapon_list(self) -> list[str]:
        return [w for w in (self.weapons or "").split(",") if w]

    @property
    def alt_path_list(self) -> list[str]:
        return [p for p in (self.alt_paths or "").split(",") if p]

    @property
    def alt_build_list(self) -> list[str]:
        return [b for b in (self.alt_builds or "").split(",") if b]

    @property
    def partner_list(self) -> list[str]:
        return [p for p in (self.partners or "").split(",") if p]

    @property
    def inner_way_list(self) -> list[str]:
        return [w for w in (self.inner_ways or "").split(",") if w]

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
        if self.rank in ("developer", "leader", "vice", "admin"):
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
    weapons = Column(String(80), nullable=True)
    weapon_other = Column(String(40), nullable=True)
    country = Column(String(64), nullable=False)
    times = Column(String(120), nullable=False)
    experience = Column(Text, nullable=False)
    why = Column(Text, nullable=True)
    lang = Column(String(5), nullable=True)
    platforms = Column(String(40), nullable=True)   # "pc,ps,mobile"
    vod_links = Column(Text, nullable=True)         # JSON-Liste mit URLs
    build = Column(Text, nullable=True)             # was man spielt / wie weit man ist
    build_link = Column(String(300), nullable=True) # (alt) Link zum Build
    inner_ways = Column(Text, nullable=True)        # gewählte Inner Ways
    region = Column(String(8), nullable=True)       # eu | other
    gear_score = Column(Integer, nullable=True)
    arena_rank = Column(String(40), nullable=True)
    build_images = Column(Text, nullable=True)      # JSON-Liste mit Dateinamen der Build-Screenshots
    status = Column(String(12), nullable=False, default="pending")  # pending | accepted | rejected
    decided_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


EVENT_KINDS = ("gvg", "raid", "scrim", "ingame", "friday", "other")
PLATFORMS = ("pc", "ps", "mobile")
REGIONS = ("eu", "other")


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


class Roster(Base):
    """Aufstellung (Gruppen) für ein Raid-Helper-Event, gepflegt von Leader/Vice."""
    __tablename__ = "rosters"
    event_id = Column(String(40), primary_key=True)
    data = Column(Text, nullable=False)                 # JSON: {"groups": [{"name", "members": [discord_id]}]}
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Partnership(Base):
    """Ingame-Partnerschaft: diese Spieler sollen in dieselbe Gruppe (gepflegt von Leader/Vice)."""
    __tablename__ = "partnerships"
    id = Column(Integer, primary_key=True)
    members = Column(Text, nullable=False)              # JSON: [{"id": discord_id, "name": Anzeigename}]
    position = Column(Integer, nullable=False, default=0)


class Emote(Base):
    """Discord-Emotes, die Raid-Helper für Klassen/Pfade nutzt (Name -> Emote-ID), für Icons auf der Website."""
    __tablename__ = "emotes"
    name = Column(String(60), primary_key=True)   # klein geschrieben, z. B. "bellstrike" oder "bellstrike_splendor"
    emote_id = Column(String(25), nullable=False)
