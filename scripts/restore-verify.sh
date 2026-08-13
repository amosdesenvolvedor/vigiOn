#!/bin/sh
set -eu

archive=${1:?Usage: restore-verify.sh BACKUP_DATABASE_SQL_GZ}
test -f "$archive"
verify_db="vigion_restore_$(date -u +%Y%m%d%H%M%S)"
case "$verify_db" in vigion_restore_[0-9]*) ;; *) exit 2 ;; esac

cleanup() {
  docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "$1"' -- "DROP DATABASE IF EXISTS \`$verify_db\`;"
}
trap cleanup EXIT INT TERM
docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "$1"' -- "CREATE DATABASE \`$verify_db\`;"
gzip -dc "$archive" | docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$1"' -- "$verify_db"
table_count=$(docker compose exec -T db sh -c 'mariadb -N -uroot -p"$MARIADB_ROOT_PASSWORD" -e "$1"' -- "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$verify_db';")
test "$table_count" -gt 20
echo "Restore verified in isolated database ($table_count tables)."
