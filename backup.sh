#!/bin/sh
# Nächtliches Datenbank-Backup (läuft im Container "backup", siehe docker-compose.yml).
#   Dumps:   /backups/juiced-JJJJ-MM-TT.dump  (pg_dump, komprimiert)
#   Löschen: älter als BACKUP_KEEP_DAYS (Standard 14)
#   Schutz: mit BACKUP_REQUIRE_MARKER=1 nur sichern, wenn /backups/.storagebox existiert
#   Sofort ein Backup:  docker compose exec backup /bin/sh /backup.sh now
#   Wiederherstellen:   docker compose exec -T db pg_restore -U juiced -d juiced --clean --if-exists < data/backups/juiced-JJJJ-MM-TT.dump
set -u
KEEP="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR:-4}"

dump() {
  # Ziel muss die eingehängte Storage Box sein (Markierungsdatei), sonst landen Backups unbemerkt auf der Server-Platte
  if [ "${BACKUP_REQUIRE_MARKER:-0}" = "1" ] && [ ! -f /backups/.storagebox ]; then
    echo "[backup] $(date '+%F %T') FEHLER: /backups/.storagebox fehlt (Storage Box nicht eingehängt?) - kein Backup" >&2
    return 1
  fi
  f="/backups/juiced-$(date +%F).dump"
  if pg_dump -Fc -f "$f.tmp"; then
    mv "$f.tmp" "$f"
    echo "[backup] $(date '+%F %T') gespeichert: $f ($(du -h "$f" | cut -f1))"
  else
    rm -f "$f.tmp"
    echo "[backup] $(date '+%F %T') FEHLER beim Backup" >&2
  fi
  find /backups -name 'juiced-*.dump' -mtime +"$KEEP" -delete
}

if [ "${1:-}" = "now" ]; then dump; exit $?; fi

# beim Start einmal sichern, falls heute noch keins existiert
[ -f "/backups/juiced-$(date +%F).dump" ] || dump

# Sekunden bis zur nächsten Backup-Uhrzeit (ohne "date -d", das kann Alpine nicht zuverlässig)
until_next() {
  h=$(date +%H); m=$(date +%M); sec=$(date +%S)
  now=$(( ${h#0} * 3600 + ${m#0} * 60 + ${sec#0} ))
  wait=$(( HOUR * 3600 - now ))
  [ "$wait" -le 0 ] && wait=$(( wait + 86400 ))
  echo "$wait"
}

while true; do
  sleep "$(until_next)"
  dump
done
