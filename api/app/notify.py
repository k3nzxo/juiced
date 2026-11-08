"""Benachrichtigungen: Discord-DM über den Bot (optional) und Webhook für Bewerbungen. Läuft im Hintergrund."""
import threading

import httpx

from .config import APPLY_WEBHOOK_URL, DISCORD_BOT_TOKEN, PUBLIC_URL

API = "https://discord.com/api/v10"
# Hinweis unter jeder DM, wie man sie abstellt
DM_FOOTER = "Don't want these messages? Turn them off in your profile on juiced.team."


def _bg(fn, *args):
    threading.Thread(target=fn, args=args, daemon=True).start()


def _send_dm(discord_id: str, text: str):
    try:
        h = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
        with httpx.Client(timeout=10) as c:
            ch = c.post(f"{API}/users/@me/channels", json={"recipient_id": discord_id}, headers=h)
            ch.raise_for_status()
            c.post(f"{API}/channels/{ch.json()['id']}/messages", json={"content": text[:1900]}, headers=h).raise_for_status()
    except Exception as e:
        print(f"[notify] DM an {discord_id} fehlgeschlagen: {e}")


def dm(discord_ids, title: str, body: str, path: str):
    if not DISCORD_BOT_TOKEN:
        return
    text = f"**{title}**\n{body}\n<{PUBLIC_URL}{path}>\n-# {DM_FOOTER}"
    for did in {d for d in discord_ids if d}:
        _bg(_send_dm, did, text)


def _post_webhook(payload: dict):
    try:
        with httpx.Client(timeout=10) as c:
            c.post(APPLY_WEBHOOK_URL, json=payload).raise_for_status()
    except Exception as e:
        print(f"[notify] Webhook fehlgeschlagen: {e}")


def scrim_webhook(r) -> None:
    if not APPLY_WEBHOOK_URL:
        return
    fields = [
        {"name": "Guild", "value": r.guild_name[:100], "inline": True},
        {"name": "Contact", "value": r.contact[:100], "inline": True},
        {"name": "Server", "value": (r.server or "—")[:100], "inline": True},
        {"name": "Format", "value": (r.format or "—")[:100], "inline": True},
        {"name": "When", "value": r.proposed_times[:300]},
    ]
    if r.message:
        fields.append({"name": "Message", "value": r.message[:1000]})
    _bg(_post_webhook, {
        "username": "juiced.team",
        "allowed_mentions": {"parse": []},
        "embeds": [{"title": "Custom game request", "url": f"{PUBLIC_URL}/en/app/#/matches",
                    "color": 0xFF7A18, "fields": fields}],
    })


def application_webhook(a) -> None:
    if not APPLY_WEBHOOK_URL:
        return
    fields = [
        {"name": "Discord", "value": a.discord[:100], "inline": True},
        {"name": "In-game", "value": a.ingame[:100], "inline": True},
        {"name": "Role", "value": a.main_role + (f" ({', '.join(filter(None, [*(a.weapons or '').split(','), a.weapon_other or '']))})"
                                                  if (a.weapons or a.weapon_other) else ""), "inline": True},
        {"name": "Country", "value": a.country[:100], "inline": True},
        {"name": "Region", "value": (a.region or "—").upper(), "inline": True},
        {"name": "Gear Score", "value": str(a.gear_score or "—"), "inline": True},
        {"name": "Arena", "value": (a.arena_rank or "—")[:100], "inline": True},
        {"name": "Build", "value": ((a.build or "—")[:700] + (f"\nInner Ways: {a.inner_ways}" if a.inner_ways else "")
                                    + (" (+ screenshots)" if a.build_images and a.build_images != "[]" else ""))[:1000]},
        {"name": "Experience", "value": a.experience[:1000] or "—"},
    ]
    if a.why:
        fields.append({"name": "Why JUICED", "value": a.why[:1000]})
    _bg(_post_webhook, {
        "username": "juiced.team",
        "allowed_mentions": {"parse": []},
        "embeds": [{"title": "New application", "url": f"{PUBLIC_URL}/en/app/#/applications",
                    "color": 0xFF3D77, "fields": fields}],
    })
