#!/bin/sh
# Backups for the hosted demo: both databases (portal and Keycloak) and the document store.
#   loop          back up now, then every 24 hours (the compose "backup" service runs this)
#   once          one backup now
#   list          the backups kept on the server
#   restore-test  restore the newest backup into a scratch database and compare row counts with the live one
# Keeps KEEP_DAYS days. Connection settings come from PGHOST, PGUSER and PGPASSWORD.
set -eu
export PGOPTIONS="-c client_min_messages=warning"
KEEP_DAYS=${KEEP_DAYS:-14}
DIR=/backups

once() {
  ts=$(date -u +%Y%m%d-%H%M%S)
  d=$DIR/$ts
  mkdir -p "$d"
  pg_dump -Fc -d pcp -f "$d/pcp.dump"
  pg_dump -Fc -d keycloak -f "$d/keycloak.dump"
  tar -czf "$d/storage.tgz" -C /storage .
  (cd "$d" && sha256sum pcp.dump keycloak.dump storage.tgz > SHA256SUMS)
  find "$DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
  echo "$(date -u '+%F %T') backup $ts ($(du -sh "$d" | cut -f1))"
}

restore_test() {
  d=$(ls -1d "$DIR"/*/ 2>/dev/null | sort | tail -1)
  [ -n "$d" ] || { echo "No backup yet"; exit 1; }
  (cd "$d" && sha256sum -c -s SHA256SUMS) || { echo "Checksum mismatch in $d"; exit 1; }
  psql -d postgres -qc "DROP DATABASE IF EXISTS restore_test" -c "CREATE DATABASE restore_test"
  pg_restore -d restore_test --no-owner "$d/pcp.dump"
  tables=$(psql -d restore_test -Atc "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
  n=0; diff=0
  for t in $tables; do
    a=$(psql -d restore_test -Atc "SELECT count(*) FROM \"$t\"")
    b=$(psql -d pcp -Atc "SELECT count(*) FROM \"$t\"")
    n=$((n + 1))
    [ "$a" = "$b" ] || { diff=$((diff + 1)); echo "  $t: backup $a rows, live $b rows (changed since the backup)"; }
  done
  tar -tzf "$d/storage.tgz" > /dev/null
  psql -d postgres -qc "DROP DATABASE restore_test"
  echo "Restore test of $(basename "$d"): $n tables restored, $diff changed since the backup, document archive readable."
}

case "${1:-once}" in
  loop)
    until pg_isready -q; do sleep 2; done
    while true; do once || echo "backup failed"; sleep 86400; done
    ;;
  once) once ;;
  list) ls -1 "$DIR" | sort | while read -r b; do echo "$b  $(du -sh "$DIR/$b" | cut -f1)"; done ;;
  restore-test) restore_test ;;
  *) echo "usage: backup.sh loop|once|list|restore-test"; exit 1 ;;
esac
