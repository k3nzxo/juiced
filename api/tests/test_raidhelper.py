"""Raid-Helper-Logik ohne Netz: Aufstellung speichern, Partner-Namen zuordnen, Absage-Titel, Erwähnungs-Pakete."""
from app import raidhelper as rh

from conftest import ORIGIN


# ---------------------------------------------------------------- Aufstellung speichern

def test_roster_save_dedupes_and_clamps(client_for):
    c = client_for("leadr", "leader")
    r = c.put("/api/raidhelper/rosters/900", headers=ORIGIN, json={"groups": [
        {"name": "  Attack   Team ", "members": ["1", "2", "2", "bad id!"], "size": 99},
        {"name": "", "members": ["2", "3"], "size": 0},
    ]})
    assert r.status_code == 200
    groups = r.json()["roster"]["groups"]
    assert groups[0] == {"name": "Attack Team", "members": ["1", "2"], "size": 40}
    assert groups[1]["members"] == ["3"]          # jeder Spieler nur einmal
    assert groups[1]["size"] == 10                 # 0 -> Standard


def test_roster_empty_deletes(client_for):
    c = client_for("leadr2", "leader")
    c.put("/api/raidhelper/rosters/901", headers=ORIGIN, json={"groups": [{"members": ["1"]}]})
    r = c.put("/api/raidhelper/rosters/901", headers=ORIGIN, json={"groups": []})
    assert r.json()["roster"] is None


def test_roster_bad_event_id(client_for):
    c = client_for("leadr3", "leader")
    assert c.put("/api/raidhelper/rosters/a%20b", headers=ORIGIN, json={"groups": []}).status_code == 404


# ---------------------------------------------------------------- Partner-Namen

CANDS = {
    "1": {"name": "LilGulp", "keys": {"lilgulp", "papi"}},
    "2": {"name": "Kasedeem", "keys": {"kasedeemsilver1checkpoint", "kasedeem"}},
    "3": {"name": "Kai", "keys": {"kai"}},
    "4": {"name": "Kaizxzen", "keys": {"kaizxzen"}},
}


def test_resolve_exact_and_alias():
    assert rh._resolve("LilGulp", CANDS)["status"] == "ok"
    assert rh._resolve("papi", CANDS)["id"] == "1"          # Zweitname
    assert rh._resolve("lil-gulp", CANDS)["id"] == "1"       # Sonderzeichen egal


def test_resolve_unsure_ambiguous_missing():
    r = rh._resolve("kased", CANDS)
    assert r["status"] == "unsure" and r["id"] == "2"
    assert rh._resolve("kai", CANDS)["status"] == "ok"        # exakt schlägt Teiltreffer
    assert rh._resolve("nobody", CANDS)["status"] == "missing"


def test_parse_separators():
    lines = rh._parse("Alice, Bob\nCarl und Dana + Eve\n\nFinn and Gina / Hugo")
    assert lines == [["Alice", "Bob"], ["Carl", "Dana", "Eve"], ["Finn", "Gina", "Hugo"]]


# ---------------------------------------------------------------- Absagen

def test_cancel_title_roundtrip():
    t = rh.CANCEL_PREFIX + "Weekly Raid"
    assert rh._is_cancelled(t)
    assert rh._plain_title(t) == "Weekly Raid"
    assert rh._plain_title(rh.CANCEL_PREFIX + rh._plain_title(t)) == "Weekly Raid"   # kein doppeltes Präfix
    assert not rh._is_cancelled("Cancelled Raid Night")
    assert rh._is_cancelled("ABGESAGT: GvG") and rh._plain_title("ABGESAGT: GvG") == "GvG"


# ---------------------------------------------------------------- Erwähnungen auf Nachrichten verteilen

def test_mention_chunks_limits():
    ids = [str(10 ** 17 + i) for i in range(250)]
    chunks = rh._mention_chunks("head\n", ids)
    assert sum(len(c_ids) for _, c_ids in chunks) == 250
    for content, c_ids in chunks:
        assert len(content) <= 1950 and len(c_ids) <= 100
        assert all(f"<@{i}>" in content for i in c_ids)       # genau die erwähnten IDs


def test_mention_chunks_single():
    chunks = rh._mention_chunks("head\n", ["1", "2"])
    assert chunks == [("head\n<@1> <@2> ", ["1", "2"])]


# ---------------------------------------------------------------- Anwesenheit (Antwortform laut Server-Log)

def test_attendance_total_from_percentage(monkeypatch):
    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"result": [{"id": "111", "name": "symbol", "attended": 12, "percentage": 48},
                               {"id": "222", "name": "x", "attended": 0, "percentage": 0}]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, *a, **k):
            return FakeResp()

    monkeypatch.setattr(rh, "API_KEY", "k")
    monkeypatch.setattr(rh, "SERVER_ID", "1")
    monkeypatch.setattr(rh.httpx, "Client", FakeClient)
    rh._att_cache.clear()
    m = rh.get_attendance(30)["members"]
    assert m["111"] == {"attended": 12, "total": 25, "pct": 48}
    assert m["222"] == {"attended": 0, "total": None, "pct": 0}
    rh._att_cache.clear()


# ---------------------------------------------------------------- Erinnerung/Absage: Pings oben, Karte darunter

def test_post_pings_embed_first_message_only(monkeypatch):
    from types import SimpleNamespace
    posts = []
    monkeypatch.setattr(rh, "_discord", lambda method, path, **kw: posts.append(kw["json"]))
    ids = [str(10 ** 17 + i) for i in range(150)]
    emb = rh._embed("Weekly Raid", "https://discord.com/channels/1/2/3", "sign up", SimpleNamespace(discord_id="42"))
    rh._post_pings("555", ids, emb)
    assert len(posts) == 2                                   # 150 Leute -> 2 Nachrichten
    assert posts[0]["embeds"][0]["title"] == "Weekly Raid"
    assert "Sent by <@42>" in posts[0]["embeds"][0]["description"]
    assert "embeds" not in posts[1]
    assert sum(len(p["allowed_mentions"]["users"]) for p in posts) == 150
    assert all(p["content"].startswith("<@") for p in posts)  # nur Erwähnungen im Text
