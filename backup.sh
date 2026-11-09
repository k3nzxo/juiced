#!/bin/sh
# Nächtliches Datenbank-Backup (läuft im Container "backup", siehe docker-compose.yml).
#   Dumps:   /backups/juiced-JJJJ-MM-TT.dump  (pg_dump, komprimiert)
#   Löschen: älter als BACKUP_KEEP_DAYS (Standard 14)
#   Schutz: mit BACKUP_REQUIRE_MARKER=1 nur sichern, wenn /backups/.storagebox existiert
#   Sofort ein Backup:  docker compose exec backup /bin/sh /backup.sh now
#   Nur Test (letztes): docker compose exec backup /bin/sh /backup.sh restore-test
#   Wiederherstellen:   docker compose exec -T db pg_restore -U juiced -d juiced --clean --if-exists < data/backups/juiced-JJJJ-MM-TT.dump
#   Test: nach jedem Backup wird es probeweise in die Wegwerf-Datenbank "juiced_restore_test" eingespielt und geprüft.
#         Ergebnis in /backups/.restore-ok bzw. /backups/.restore-failed (liest die Überwachung, siehe monitor/).
set -u
KEEP="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR:-4}"

# Backup probeweise wiederherstellen: nur ein Backup, das sich einspielen lässt, ist eins
restore_test() {
  t=juiced_restore_test
  fail() {
    echo "[backup] $(date '+%F %T') FEHLER Wiederherstellungstest ($1): $2" >&2
    echo "$(date '+%F %T') $(basename "$1"): $2" > /backups/.restore-failed
    dropdb --if-exists "$t" >/dev/null 2>&1
    return 1
  }
  dropdb --if-exists "$t" >/dev/null 2>&1
  createdb "$t" || { fail "$1" "Test-Datenbank nicht anlegbar"; return 1; }
  pg_restore --no-owner --exit-on-error -d "$t" "$1" >/dev/null 2>&1 || { fail "$1" "pg_restore fehlgeschlagen"; return 1; }
  users=$(psql -d "$t" -Atc "SELECT count(*) FROM users" 2>/dev/null)
  vods=$(psql -d "$t" -Atc "SELECT count(*) FROM vods" 2>/dev/null)
  dropdb --if-exists "$t" >/dev/null 2>&1
  case "$users" in ''|*[!0-9]*|0) fail "$1" "keine Mitglieder im Backup (users=$users)"; return 1 ;; esac
  echo "$(date '+%F %T') $(basename "$1"): $users Mitglieder, $vods VODs" > /backups/.restore-ok
  rm -f /backups/.restore-failed
  echo "[backup] $(date '+%F %T') Wiederherstellungstest ok: $users Mitglieder, $vods VODs"
}

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
    restore_test "$f"
  else
    rm -f "$f.tmp"
    echo "[backup] $(date '+%F %T') FEHLER beim Backup" >&2
  fi
  find /backups -name 'juiced-*.dump' -mtime +"$KEEP" -delete
}

if [ "${1:-}" = "now" ]; then dump; exit $?; fi

if [ "${1:-}" = "restore-test" ]; then
  latest=$(ls -1t /backups/juiced-*.dump 2>/dev/null | head -1)
  [ -n "$latest" ] && restore_test "$latest"; exit $?
fi

# beim Start einmal sichern, falls heute noch keins existiert (sonst wenigstens das letzte einmal testen)
if [ -f "/backups/juiced-$(date +%F).dump" ]; then
  [ -f /backups/.restore-ok ] || restore_test "$(ls -1t /backups/juiced-*.dump | head -1)"
else
  dump
fi

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
