"""Aktivitätsprotokoll: was protokolliert wird und wer es sehen darf."""
from app import activity

from conftest import ORIGIN


def test_labels():
    assert activity.label_for("PUT", "/api/me") == (True, "Saved own profile")
    assert activity.label_for("POST", "/api/vods/12/notes") == (True, "Commented on a VOD")
    assert activity.label_for("DELETE", "/api/vods/12") == (True, "Deleted a VOD")
    assert activity.label_for("POST", "/api/raidhelper/partnerships/check")[0] is False
    assert activity.label_for("POST", "/api/whatever") == (True, "POST /api/whatever")


def test_logged_and_only_developer_sees(client_for):
    m = client_for("logmem", "member")
    m.put("/api/me", json={"ingame_name": "LogMember"}, headers=ORIGIN)
    dev = client_for("logdev", "developer")
    items = dev.get("/api/admin/logs").json()["items"]
    mine = [i for i in items if i["user"] and i["user"]["name"] == "LogMember"]
    assert [i["action"] for i in mine][:2] == ["Saved own profile", "Signed in"]   # neueste zuerst
    assert mine[0]["status"] == 200
    assert m.get("/api/admin/logs").status_code == 403
    assert client_for("logvice", "vice").get("/api/admin/logs").status_code == 403
    assert dev.get("/api/admin/logs", params={"q": "own profile"}).json()["items"][0]["action"] == "Saved own profile"


def test_chunks_and_reads_not_logged(client_for):
    dev = client_for("logdev2", "developer")
    before = dev.get("/api/admin/logs").json()["items"][0]["id"]
    dev.get("/api/members")
    dev.put("/api/vods/999/chunk", params={"index": 0}, content=b"x", headers=ORIGIN)
    after = dev.get("/api/admin/logs").json()["items"][0]["id"]
    assert after == before
