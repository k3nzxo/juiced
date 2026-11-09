"""Überwachung (monitor/monitor.py): wann gemeldet wird, Backup-/Test-Prüfungen, DM-Versand."""
import importlib.util
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

_spec = importlib.util.spec_from_file_location(
    "monitor", os.path.join(os.path.dirname(__file__), "..", "..", "monitor", "monitor.py"))
mon = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mon)


def test_alert_only_after_two_fails_then_remind_and_recover():
    s = mon.State()
    assert s.update({"api": "HTTP 502"}, 0) == []                       # ein Aussetzer: still
    msgs = s.update({"api": "HTTP 502"}, 120)
    assert len(msgs) == 1 and "API / Datenbank" in msgs[0] and "HTTP 502" in msgs[0]
    assert s.update({"api": "HTTP 502"}, 240) == []                     # nicht jede Runde
    again = s.update({"api": "HTTP 502"}, 120 + 6 * 3600)
    assert len(again) == 1 and "immer noch" in again[0]                 # Erinnerung nach 6 h
    ok = s.update({"api": None}, 130 + 6 * 3600)
    assert ok == ["✅ **juiced.team – wieder ok:** API / Datenbank"]
    assert s.update({"api": None}, 99999) == []


def test_single_blip_never_alerts():
    s = mon.State()
    for t in range(0, 1200, 120):
        assert s.update({"site": "URLError" if t % 240 == 0 else None}, t) == []


def test_backup_and_restore_checks(tmp_path, monkeypatch):
    monkeypatch.setattr(mon, "BACKUP_DIR", str(tmp_path))
    monkeypatch.setattr(mon, "BACKUP_MARKER", True)
    assert "nicht eingehängt" in mon.check_backup()
    (tmp_path / ".storagebox").write_text("")
    assert mon.check_backup() == "kein Backup gefunden"
    d = tmp_path / "juiced-2026-11-09.dump"
    d.write_bytes(b"x")
    assert mon.check_backup() is None
    old = time.time() - 30 * 3600
    os.utime(d, (old, old))
    assert "30 h alt" in mon.check_backup()

    assert mon.check_restore() == "noch kein erfolgreicher Test"
    (tmp_path / ".restore-ok").write_text("ok")
    assert mon.check_restore() is None
    time.sleep(0.01)
    (tmp_path / ".restore-failed").write_text("2026-11-09 juiced.dump: pg_restore fehlgeschlagen")
    assert "pg_restore fehlgeschlagen" in mon.check_restore()        # neuer Fehler schlägt altes ok


def test_send_dm_to_owner(monkeypatch):
    got = []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            got.append((self.path, body, self.headers["Authorization"]))
            out = json.dumps({"id": "777"} if self.path == "/users/@me/channels" else {}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        monkeypatch.setattr(mon, "DISCORD_API", f"http://127.0.0.1:{srv.server_port}")
        monkeypatch.setattr(mon, "TOKEN", "tok")
        monkeypatch.setattr(mon, "OWNERS", ["123"])
        mon.send("🔴 test")
    finally:
        srv.shutdown()
    assert got[0] == ("/users/@me/channels", {"recipient_id": "123"}, "Bot tok")
    assert got[1][0] == "/channels/777/messages" and got[1][1]["content"] == "🔴 test"
