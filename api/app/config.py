"""Konfiguration ausschließlich über Umgebungsvariablen (.env auf dem Server)."""
import os


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


DATABASE_URL = _env("DATABASE_URL", "sqlite:///./juiced-dev.db")
SECRET_KEY = _env("SECRET_KEY")
if not SECRET_KEY or len(SECRET_KEY) < 32:
    if _env("ENV", "dev") == "prod":
        raise RuntimeError("SECRET_KEY fehlt oder ist zu kurz (mind. 32 Zeichen)")
    SECRET_KEY = "dev-secret-dev-secret-dev-secret-dev"

PUBLIC_URL = _env("PUBLIC_URL", "http://localhost:4321").rstrip("/")
IS_PROD = _env("ENV", "dev") == "prod"

# Discord OAuth2 (Login)
DISCORD_CLIENT_ID = _env("DISCORD_CLIENT_ID")
DISCORD_CLIENT_SECRET = _env("DISCORD_CLIENT_SECRET")
DISCORD_GUILD_ID = _env("DISCORD_GUILD_ID")  # optional: Rollen vom JUICED-Server übernehmen
OWNER_DISCORD_IDS = {x.strip() for x in _env("OWNER_DISCORD_IDS").split(",") if x.strip()}  # immer Leader

# Discord-Rolle -> Website-Rang/Coach-Rolle, z. B. "leader:111,vice:222,member:444,coach_healer:555"
ROLE_MAP: dict[str, str] = {}
for _pair in _env("DISCORD_ROLE_MAP").split(","):
    if ":" in _pair:
        _k, _v = _pair.split(":", 1)
        ROLE_MAP[_v.strip()] = _k.strip()

# Webhook für neue Bewerbungen (privater Discord-Kanal der Leitung)
APPLY_WEBHOOK_URL = _env("DISCORD_APPLY_WEBHOOK")
# Bot-Token nur zum Verschicken von DMs (optional)
DISCORD_BOT_TOKEN = _env("DISCORD_BOT_TOKEN")

VAPID_PUBLIC_KEY = _env("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = _env("VAPID_PRIVATE_KEY")

SESSION_COOKIE = "juiced_session"
SESSION_DAYS = 30
