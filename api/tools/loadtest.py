"""Lasttest für die API: viele Mitglieder klicken gleichzeitig durch die Seiten, während mehrere VODs hochgeladen werden.

NUR gegen eine lokale/Test-Instanz mit DEV_LOGIN=1 laufen lassen (legt Test-Nutzer und Test-Uploads an).

    python tools/loadtest.py --base http://127.0.0.1:8010 --users 30 --uploaders 5 --upload-mb 160 --seconds 60

Ablauf: Phase 1 nur Seitenaufrufe, Phase 2 Seitenaufrufe + Uploads. Danach Antwortzeiten je Seite (Median, 95 %, Max),
Fehler und Upload-Durchsatz. Die angelegten Test-VODs werden am Ende wieder gelöscht.
"""
import argparse
import asyncio
import os
import random
import statistics
import time
from collections import defaultdict

import httpx

CHUNK = 16 * 1024 * 1024

# was die einzelnen Seiten im Mitgliederbereich abfragen (wie im Browser)
PAGES = {
    "dashboard": ["/api/events?start=2026-01-01T00:00:00Z&end=2026-01-15T00:00:00Z", "/api/members", "/api/announcements"],
    "signups": ["/api/raidhelper/events"],
    "roster": ["/api/members"],
    "member": ["/api/members/{mid}", "/api/vods", "/api/raidhelper/attendance?days=30"],
    "vods": ["/api/vods", "/api/vods/storage"],
    "profile": ["/api/raidhelper/people"],
}


class Stats:
    def __init__(self):
        self.lat = defaultdict(list)
        self.err = defaultdict(int)

    def add(self, key, dt, ok):
        self.lat[key].append(dt)
        if not ok:
            self.err[key] += 1

    def report(self, title):
        print(f"\n== {title}")
        print(f"{'Anfrage':34} {'Anzahl':>6} {'Median':>8} {'95 %':>8} {'Max':>8} {'Fehler':>7}")
        for key in sorted(self.lat):
            xs = sorted(self.lat[key])
            p95 = xs[min(len(xs) - 1, int(len(xs) * 0.95))]
            print(f"{key:34} {len(xs):6} {statistics.median(xs) * 1000:7.0f}ms {p95 * 1000:7.0f}ms {xs[-1] * 1000:7.0f}ms {self.err[key]:7}")


def _key(path):
    p = path.split("?")[0]
    return "/api/members/{id}" if p.startswith("/api/members/") else p


async def login(base, name, rank):
    c = httpx.AsyncClient(base_url=base, timeout=60, headers={"Origin": base})
    r = await c.get("/api/auth/dev-login", params={"name": name, "rank": rank}, follow_redirects=False)
    if r.status_code != 302:  # Login leitet auf den Mitgliederbereich weiter
        raise SystemExit(f"Login fehlgeschlagen ({r.status_code}) - läuft die API mit DEV_LOGIN=1?")
    return c


async def browse(c, stats, stop, member_ids):
    while time.time() < stop:
        page = random.choice(list(PAGES))
        paths = [p.replace("{mid}", str(random.choice(member_ids))) for p in PAGES[page]]

        async def one(p):
            t = time.perf_counter()
            try:
                r = await c.get(p)
                ok = r.status_code < 500
            except httpx.HTTPError:
                ok = False
            stats.add(_key(p), time.perf_counter() - t, ok)

        await asyncio.gather(*(one(p) for p in paths))  # Browser fragt die Seite auch parallel ab
        if random.random() < 0.3:
            await one("/api/notifications")
        await asyncio.sleep(random.uniform(1, 3))       # "Lesezeit"


async def upload(c, stats, size, up_stats, created):
    t0 = time.perf_counter()
    r = await c.post("/api/vods", json={"title": "Lasttest", "role": "healer", "filename": "lt.mp4", "size_bytes": size})
    if r.status_code != 200:
        stats.add("POST /api/vods", time.perf_counter() - t0, False)
        print("Upload anlegen fehlgeschlagen:", r.status_code, r.text[:200])
        return
    vid = r.json()["id"]
    created.append((c, vid))
    blob = os.urandom(CHUNK)
    queue = list(range(-(-size // CHUNK)))

    async def worker():
        while queue:
            i = queue.pop(0)
            n = min(CHUNK, size - i * CHUNK)
            t = time.perf_counter()
            try:
                rr = await c.put(f"/api/vods/{vid}/chunk", params={"index": i}, content=blob[:n])
                ok = rr.status_code == 200
            except httpx.HTTPError:
                ok = False
            stats.add("PUT chunk (16 MB)", time.perf_counter() - t, ok)

    await asyncio.gather(*(worker() for _ in range(4)))  # wie der Browser: 4 Stücke gleichzeitig
    up_stats.append((size, time.perf_counter() - t0))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8010")
    ap.add_argument("--users", type=int, default=30)
    ap.add_argument("--uploaders", type=int, default=5)
    ap.add_argument("--upload-mb", type=int, default=160)
    ap.add_argument("--seconds", type=int, default=60)
    a = ap.parse_args()

    clients = [await login(a.base, f"lt{i}", "vice" if i % 10 == 0 else "member") for i in range(a.users)]
    member_ids = [m["id"] for m in (await clients[0].get("/api/members")).json()][:50] or [1]

    s1 = Stats()
    stop = time.time() + a.seconds / 2
    await asyncio.gather(*(browse(c, s1, stop, member_ids) for c in clients))
    s1.report(f"Phase 1: {a.users} Nutzer, keine Uploads")

    s2, up, created = Stats(), [], []
    ups = [await login(a.base, f"ltup{i}", "member") for i in range(a.uploaders)]
    stop = time.time() + a.seconds / 2
    size = a.upload_mb * 1024 * 1024
    await asyncio.gather(*(browse(c, s2, stop, member_ids) for c in clients),
                         *(upload(c, s2, size, up, created) for c in ups))
    s2.report(f"Phase 2: {a.users} Nutzer + {a.uploaders} Uploads à {a.upload_mb} MB")
    if up:
        total = sum(sz for sz, _ in up) / 1024 / 1024
        slowest = max(dt for _, dt in up)
        print(f"\nUploads: {len(up)} fertig, {total:.0f} MB in {slowest:.1f} s -> {total / slowest:.0f} MB/s gesamt")

    for c, vid in created:  # Test-VODs wieder weg
        await c.delete(f"/api/vods/{vid}")
    for c in clients + ups:
        await c.aclose()


if __name__ == "__main__":
    asyncio.run(main())
