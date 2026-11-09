"""Grundlegende API-Tests: Login/Rechte, Profil & Builds, Builds anderer, CSRF, Raid-Helper ohne Schlüssel."""
from app import wwm
from app.errors import describe

from conftest import ORIGIN


# ---------------------------------------------------------------- Login und Rechte

def test_me_without_login(anon):
    r = anon.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["user"] is None


def test_dev_login_and_me(client_for):
    c = client_for("alice", "member")
    u = c.get("/api/auth/me").json()["user"]
    assert u["username"] == "alice"
    assert u["is_member"] is True
    assert u["can_manage"] is False


def test_guest_cannot_see_members(client_for):
    c = client_for("guesty", "guest")
    assert c.get("/api/members").status_code == 403


def test_members_need_login(anon):
    assert anon.get("/api/members").status_code == 401


# ---------------------------------------------------------------- CSRF-Schutz

def test_write_without_origin_is_blocked(client_for):
    c = client_for("bob", "member")
    r = c.put("/api/me", json={"ingame_name": "Bob"})
    assert r.status_code == 403


def test_write_with_origin_works(client_for):
    c = client_for("bob2", "member")
    r = c.put("/api/me", json={"ingame_name": "Bobby"}, headers=ORIGIN)
    assert r.status_code == 200
    assert r.json()["user"]["display_name"] == "Bobby"


# ---------------------------------------------------------------- Builds

def test_build_hybrid_is_saved_sorted(client_for):
    c = client_for("carl", "member")
    r = c.put("/api/me", json={"main_role": "dps", "main_build": "nameless_sword+inkwell_fan"}, headers=ORIGIN)
    u = r.json()["user"]
    assert u["main_build"] == "inkwell_fan+nameless_sword"
    assert u["main_role"] == "dps"


def test_build_invalid_is_dropped(client_for):
    c = client_for("dora", "member")
    u = c.put("/api/me", json={"main_build": "nameless_sword+nameless_sword"}, headers=ORIGIN).json()["user"]
    assert u["main_build"] is None
    u = c.put("/api/me", json={"main_build": "foo+bar"}, headers=ORIGIN).json()["user"]
    assert u["main_build"] is None


def test_alt_builds_dedupe_and_exclude_main(client_for):
    c = client_for("emil", "member")
    u = c.put("/api/me", json={
        "main_build": "nameless_sword+strategic_sword",
        "alt_builds": ["strategic_sword+nameless_sword", "thundercry_blade+infernal_twinblades",
                       "infernal_twinblades+thundercry_blade", "x+y"],
    }, headers=ORIGIN).json()["user"]
    assert u["alt_builds"] == ["infernal_twinblades+thundercry_blade"]


def test_inner_ways_only_known(client_for):
    c = client_for("finn", "member")
    u = c.put("/api/me", json={"inner_ways": ["sword_morph", "nope", "sword_morph"]}, headers=ORIGIN).json()["user"]
    assert u["inner_ways"] == ["sword_morph"]


def test_partners_not_self(client_for):
    c = client_for("gina", "member")
    me = c.get("/api/auth/me").json()["user"]
    u = c.put("/api/me", json={"partners": [me["discord_id"], "123456789012345678"]}, headers=ORIGIN).json()["user"]
    assert u["partners"] == ["123456789012345678"]


# ---------------------------------------------------------------- Builds anderer bearbeiten

def _member_id(c, name):
    return next(m["id"] for m in c.get("/api/members").json() if m["username"] == name)


def test_member_cannot_edit_others_build(client_for):
    client_for("hanna", "member")
    other = client_for("ivan", "member")
    uid = _member_id(other, "hanna")
    assert other.get(f"/api/members/{uid}").json()["can_edit_build"] is False
    r = other.put(f"/api/members/{uid}/build", json={"main_build": "panacea_fan+soulshade_umbrella"}, headers=ORIGIN)
    assert r.status_code == 403


def test_vice_can_edit_others_build(client_for):
    client_for("jana", "member")
    vice = client_for("vic", "vice")
    uid = _member_id(vice, "jana")
    assert vice.get(f"/api/members/{uid}").json()["can_edit_build"] is True
    r = vice.put(f"/api/members/{uid}/build", json={"main_role": "healer", "main_build": "panacea_fan+soulshade_umbrella"},
                 headers=ORIGIN)
    assert r.status_code == 200
    assert r.json()["main_build"] == "panacea_fan+soulshade_umbrella"
    assert r.json()["main_role"] == "healer"


# ---------------------------------------------------------------- Raid-Helper ohne Schlüssel

def test_raidhelper_not_configured(client_for):
    c = client_for("kai", "member")
    r = c.get("/api/raidhelper/events")
    assert r.status_code == 200
    assert r.json()["configured"] is False
    assert c.get("/api/raidhelper/attendance").json()["configured"] is False


def test_roster_save_needs_management(client_for):
    c = client_for("lia", "member")
    r = c.put("/api/raidhelper/rosters/123", json={"groups": []}, headers=ORIGIN)
    assert r.status_code == 403


# ---------------------------------------------------------------- Bausteine

def test_clean_build():
    assert wwm.clean_build("nameless_sword+strategic_sword") == "nameless_sword+strategic_sword"
    assert wwm.clean_build("strategic_sword+nameless_sword") == "nameless_sword+strategic_sword"
    assert wwm.clean_build("nameless_sword") is None
    assert wwm.clean_build("") is None


def test_path_weapons_cover_all_paths():
    assert set(wwm.PATH_WEAPONS) == set(wwm.PATHS)
    for a, b in wwm.PATH_WEAPONS.values():
        assert a in wwm.WEAPONS and b in wwm.WEAPONS


def test_error_codes():
    d = describe("Datei zu groß (max. 20 GB)")
    assert d["code"] == "file_too_large" and d["params"] == {"max": "20"}
    assert describe("Not found")["code"] == "not_found"
    assert "code" not in describe("something unknown")


# ---------------------------------------------------------------- Benachrichtigungen abstellen

def test_dm_off_saved_and_filtered(client_for):
    c = client_for("nora", "member")
    u = c.put("/api/me", json={"dm_off": ["new_vod", "bell_uploads", "bogus"]}, headers=ORIGIN).json()["user"]
    assert u["dm_off"] == ["new_vod", "bell_uploads"]


def test_vod_dm_respects_settings(client_for, monkeypatch):
    from app import models, notify, vods
    from app.db import SessionLocal
    sent = []
    monkeypatch.setattr(notify, "dm", lambda ids, *a, **k: sent.extend(ids))
    c = client_for("otto", "member")
    c.put("/api/me", json={"dm_off": ["vod_comments"]}, headers=ORIGIN)
    db = SessionLocal()
    try:
        u = db.query(models.User).filter(models.User.username == "otto").first()
        vods._notify(db, [u.id], "t", "b", 1, kind="vod_comments")   # abgestellt -> nichts
        vods._notify(db, [u.id], "t", "b", 1, kind="vod_review")     # an -> gesendet
    finally:
        db.close()
    assert sent == [u.discord_id]


def test_notifications_off_by_default(client_for):
    from app import models
    c = client_for("pia", "member")
    u = c.get("/api/auth/me").json()["user"]
    assert set(u["dm_off"]) == set(models.DISCORD_DM_KINDS)         # neu: Discord-DMs aus, Glocke an
    u = c.put("/api/me", json={"dm_off": []}, headers=ORIGIN).json()["user"]
    assert u["dm_off"] == []                                          # bewusst alles an bleibt an
    assert c.get("/api/auth/me").json()["user"]["dm_off"] == []


# ---------------------------------------------------------------- VOD-Upload: Stücke direkt in die Datei (wenig RAM)

def test_chunk_upload_streams_to_file(client_for, monkeypatch):
    import os
    from app import vods
    monkeypatch.setattr(vods, "CHUNK_SIZE", 1000)
    monkeypatch.setattr(vods, "WRITE_BUF", 300)      # mehrere Schreibvorgänge pro Stück
    monkeypatch.setattr(vods, "_start_processing", lambda vid: None)
    c = client_for("uli", "member")
    data = os.urandom(2500)                         # 3 Stücke: 1000 + 1000 + 500
    v = c.post("/api/vods", json={"title": "t", "role": "healer", "filename": "a.mp4", "size_bytes": len(data)},
               headers=ORIGIN).json()
    for i in (2, 0, 1):                             # beliebige Reihenfolge
        r = c.put(f"/api/vods/{v['id']}/chunk", params={"index": i}, content=data[i * 1000:(i + 1) * 1000], headers=ORIGIN)
        assert r.status_code == 200, r.text
    assert r.json() == {"done": 3, "total": 3}
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        part = vods._part_path(db.get(vods.Vod, v["id"]))
    finally:
        db.close()
    with open(part, "rb") as f:
        assert f.read() == data
    r = c.put(f"/api/vods/{v['id']}/chunk", params={"index": 2}, content=b"x" * 501, headers=ORIGIN)
    assert r.status_code == 400                     # zu groß


def test_health_checks_database(anon):
    r = anon.get("/api/health")
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_nav_items_default_save_and_limit(client_for):
    from app import models
    c = client_for("quin", "member")
    assert c.get("/api/auth/me").json()["user"]["nav_items"] == list(models.NAV_DEFAULT)
    u = c.put("/api/me", json={"nav_items": ["profile", "home", "bogus", "signups"]}, headers=ORIGIN).json()["user"]
    assert u["nav_items"] == ["home", "profile", "signups"]                     # feste Reihenfolge, Unbekanntes raus
    u = c.put("/api/me", json={"nav_items": list(models.NAV_ITEMS)}, headers=ORIGIN).json()["user"]
    assert len(u["nav_items"]) == models.NAV_MAX
    u = c.put("/api/me", json={"nav_items": []}, headers=ORIGIN).json()["user"]
    assert u["nav_items"] == []                                                  # bewusst leer bleibt leer


def test_vod_phases_saved_and_cleaned(client_for, monkeypatch):
    from app import vods
    monkeypatch.setattr(vods, "_start_processing", lambda vid: None)
    c = client_for("vera", "member")
    v = c.post("/api/vods", json={"title": "GvG", "role": "healer", "filename": "a.mp4", "size_bytes": 10,
                                  "phases": {"tower": "museflow_drum+willowbend_fan", "goose": "bogus+x", "tree": "nameless_sword+strategic_sword"}},
               headers=ORIGIN).json()
    assert v["phases"] == {"tower": "museflow_drum+willowbend_fan", "goose": None, "tree": "nameless_sword+strategic_sword"}
    r = c.put(f"/api/vods/{v['id']}", json={"phases": {"goose": "strategic_sword+nameless_sword"}}, headers=ORIGIN).json()
    assert r["phases"] == {"tower": None, "goose": "nameless_sword+strategic_sword", "tree": None}
