"""Test-Setup: eigene Wegwerf-Datenbank, Test-Login ohne Discord, kein Raid-Helper/Bot."""
import os
import sys
import tempfile

import pytest

_TMP = tempfile.mkdtemp(prefix="juiced-test-")
os.environ.update({
    "DATABASE_URL": f"sqlite:///{_TMP}/test.db",
    "VOD_DIR": f"{_TMP}/vods",
    "VOD_UPLOAD_DIR": f"{_TMP}/uploads",
    "PUBLIC_URL": "http://testserver",
    "DEV_LOGIN": "1",
    "ENV": "dev",
    "RAIDHELPER_API_KEY": "",
    "DISCORD_BOT_TOKEN": "",
})
os.makedirs(f"{_TMP}/vods", exist_ok=True)
os.makedirs(f"{_TMP}/uploads", exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ORIGIN = {"Origin": "http://testserver"}


@pytest.fixture
def client_for():
    """client_for("name", rank="member") -> eingeloggter Client (eigener Cookie)."""
    def make(name: str, rank: str = "member", coach: str = "") -> TestClient:
        c = TestClient(app)
        r = c.get("/api/auth/dev-login", params={"name": name, "rank": rank, "coach": coach}, follow_redirects=False)
        assert r.status_code == 302
        return c
    return make


@pytest.fixture
def anon():
    return TestClient(app)
