"""Überwachung für juiced.team: prüft alle paar Minuten, ob alles läuft, und schickt dem Owner bei Problemen eine Discord-DM.

Läuft als eigener Container (siehe docker-compose.yml, Dienst "monitor"), nur Python-Standardbibliothek.
Meldet sich nur bei Änderungen: einmal wenn etwas kaputt geht (nach 2 Fehlschlägen hintereinander),
alle REMIND_HOURS Stunden erneut, solange es kaputt bleibt, und einmal wenn es wieder geht.

Prüfungen:
  api        API + Datenbank antworten (intern)
  site       https://juiced.team erreichbar (von außen über den vorgeschalteten Caddy)
  vods       Storage Box für VODs eingehängt (nur mit VOD_REQUIRE_MARKER=1)
  backup     letztes Backup jünger als 26 h
  restore    letzter Wiederherstellungstest des Backups erfolgreich
  disk       genug freier Platz für laufende Uploads
"""
import glob
import json
import os
import shutil
import time
import urllib.error
import urllib.request

TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
OWNERS = [x.strip() for x in os.environ.get("OWNER_DISCORD_IDS", "").split(",") if x.strip()]
DISCORD_API = os.environ.get("DISCORD_API_BASE", "https://discord.com/api/v10")
API_URL = os.environ.get("MONITOR_API_URL", "http://api:8000/api/health")
SITE_URL = os.environ.get("MONITOR_SITE_URL", "https://juiced.team/api/health")
VOD_DIR = os.environ.get("MONITOR_VOD_DIR", "/vods")
BACKUP_DIR = os.environ.get("MONITOR_BACKUP_DIR", "/backups")
UPLOAD_DIR = os.environ.get("MONITOR_UPLOAD_DIR", "/uploads")
VOD_MARKER = os.environ.get("VOD_REQUIRE_MARKER", "0") not in ("", "0", "false")
BACKUP_MARKER = os.environ.get("BACKUP_REQUIRE_MARKER", "0") not in ("", "0", "false")
INTERVAL = int(os.environ.get("MONITOR_INTERVAL", "120"))
REMIND_HOURS = float(os.environ.get("MONITOR_REMIND_HOURS", "6"))
MIN_FREE_GB = float(os.environ.get("MONITOR_MIN_FREE_GB", "10"))
FAILS_BEFORE_ALERT = 2

LABELS = {
    "api": "API / Datenbank",
    "site": "Website von außen",
    "vods": "Storage Box (VODs)",
    "backup": "Backup",
    "restore": "Backup-Wiederherstellungstest",
    "disk": "Speicherplatz für Uploads",
}


def _http_ok(url: str) -> str | None:
    """None = ok, sonst Fehlertext."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "juiced-monitor"}), timeout=15) as r:
            body = json.loads(r.read() or b"{}")
            return None if body.get("ok") else f"Antwort ohne ok: {str(body)[:120]}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}"
    except Exception as e:  # Zeitüberschreitung, Verbindung abgelehnt, DNS ...
        return type(e).__name__ + (f": {e.reason}" if getattr(e, "reason", None) else "")


def _age_h(path: str) -> float:
    return (time.time() - os.path.getmtime(path)) / 3600


def check_backup() -> str | None:
    if BACKUP_MARKER and not os.path.exists(os.path.join(BACKUP_DIR, ".storagebox")):
        return "Storage Box für Backups nicht eingehängt (.storagebox fehlt)"
    dumps = glob.glob(os.path.join(BACKUP_DIR, "juiced-*.dump"))
    if not dumps:
        return "kein Backup gefunden"
    newest = max(dumps, key=os.path.getmtime)
    age = _age_h(newest)
    return None if age < 26 else f"letztes Backup ist {age:.0f} h alt ({os.path.basename(newest)})"


def check_restore() -> str | None:
    failed = os.path.join(BACKUP_DIR, ".restore-failed")
    ok = os.path.join(BACKUP_DIR, ".restore-ok")
    if os.path.exists(failed) and (not os.path.exists(ok) or os.path.getmtime(failed) > os.path.getmtime(ok)):
        with open(failed, encoding="utf-8", errors="replace") as f:
            return f.read().strip()[:300] or "fehlgeschlagen"
    if not os.path.exists(ok):
        return "noch kein erfolgreicher Test"
    age = _age_h(ok)
    return None if age < 26 else f"letzter erfolgreicher Test ist {age:.0f} h alt"


def check_disk() -> str | None:
    free = shutil.disk_usage(UPLOAD_DIR).free / 1024 ** 3
    return None if free >= MIN_FREE_GB else f"nur noch {free:.1f} GB frei"


def run_checks() -> dict:
    checks = {
        "api": lambda: _http_ok(API_URL),
        "site": lambda: _http_ok(SITE_URL),
        "backup": check_backup,
        "restore": check_restore,
        "disk": check_disk,
    }
    if VOD_MARKER:
        checks["vods"] = lambda: None if os.path.exists(os.path.join(VOD_DIR, ".storagebox")) else "nicht eingehängt (.storagebox fehlt)"
    out = {}
    for name, fn in checks.items():
        try:
            out[name] = fn()
        except Exception as e:  # eine kaputte Prüfung darf die anderen nicht stoppen
            out[name] = f"Prüfung fehlgeschlagen: {type(e).__name__}"
    return out


def _discord(method: str, path: str, payload: dict) -> dict:
    req = urllib.request.Request(f"{DISCORD_API}{path}", data=json.dumps(payload).encode(), method=method, headers={
        "Authorization": f"Bot {TOKEN}", "Content-Type": "application/json", "User-Agent": "juiced-monitor (https://juiced.team, 1)"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read() or b"{}")


def send(text: str):
    print(f"[monitor] {text}", flush=True)
    if not TOKEN or not OWNERS:
        print("[monitor] keine DM: DISCORD_BOT_TOKEN oder OWNER_DISCORD_IDS fehlt", flush=True)
        return
    for uid in OWNERS:
        try:
            ch = _discord("POST", "/users/@me/channels", {"recipient_id": uid})
            _discord("POST", f"/channels/{ch['id']}/messages", {"content": text[:1900], "allowed_mentions": {"parse": []}})
        except Exception as e:
            print(f"[monitor] DM an {uid} fehlgeschlagen: {type(e).__name__}", flush=True)


class State:
    def __init__(self):
        self.fails: dict = {}      # Name -> Fehlschläge hintereinander
        self.alerted: dict = {}    # Name -> Zeitpunkt der letzten Meldung (nur solange kaputt)

    def update(self, results: dict, now: float) -> list[str]:
        """Ergebnisse einarbeiten, Nachrichten zurückgeben, die verschickt werden sollen."""
        down, up = [], []
        for name, err in results.items():
            label = LABELS.get(name, name)
            if err is None:
                self.fails[name] = 0
                if name in self.alerted:
                    del self.alerted[name]
                    up.append(label)
                continue
            self.fails[name] = self.fails.get(name, 0) + 1
            if self.fails[name] < FAILS_BEFORE_ALERT:
                continue
            last = self.alerted.get(name)
            if last is None or now - last >= REMIND_HOURS * 3600:
                down.append(f"• **{label}**: {err}" + (" (immer noch)" if last is not None else ""))
                self.alerted[name] = now
        msgs = []
        if down:
            msgs.append("🔴 **juiced.team – Problem**\n" + "\n".join(down))
        if up:
            msgs.append("✅ **juiced.team – wieder ok:** " + ", ".join(up))
        return msgs


def main():
    print(f"[monitor] gestartet: alle {INTERVAL} s, Meldung an {len(OWNERS)} Person(en)", flush=True)
    state = State()
    while True:
        for msg in state.update(run_checks(), time.time()):
            send(msg)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
