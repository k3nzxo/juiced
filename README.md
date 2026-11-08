# juiced.team

Website der Gilde **JUICED** (EUW · Where Winds Meet).

- `web/`: Astro (statisch, 8 Sprachen, Hell/Dunkel), ausgeliefert von Caddy
- `api/`: FastAPI. Discord-Login, Ränge und Rollen, Ankündigungen, Bewerbungen, VOD-Reviews
- `docker-compose.yml`: Stack `juiced` (db, api, web). HTTPS kommt vom Caddy im `~/archiv`-Stack.

## Rechte

| Rang | darf |
|---|---|
| Leader / Vice | alles: Ankündigungen, Bewerbungen, alle VODs, Ränge und Rollen (nur der Leader vergibt Leader/Vice) |
| Coach (Healer/Tank/Nameless) | alle VODs der eigenen Rolle bearbeiten, behalten, löschen |
| Mitglied | eigene VODs + Team-VODs, Roster, Ankündigungen lesen |
| Gast | nichts (nur die öffentliche Seite) |

Ränge kommen beim Login aus Discord (`DISCORD_ROLE_MAP`), außer ein Admin hat sie auf der Seite manuell gesetzt.

## Update auf dem Server

```bash
cd ~/juiced && git pull && docker compose up -d --build
```

## Lokal entwickeln

```bash
cd api && DEV_LOGIN=1 uvicorn app.main:app --port 8010
cd web && npm install && npm run dev
```
Test-Login (nur lokal): `http://localhost:4321/api/auth/dev-login?name=test&rank=leader`
