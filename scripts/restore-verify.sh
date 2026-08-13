#!/bin/sh
set -eu

archive=${1:?Usage: restore-verify.sh BACKUP_DATABASE_SQL_GZ}
test -f "$archive"
verify_db="vigion_restore_$(date -u +%Y%m%d%H%M%S)"
case "$verify_db" in vigion_restore_[0-9]*) ;; *) exit 2 ;; esac

cleanup() {
  docker compose exec -T db mariadb -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "DROP DATABASE IF EXISTS \`$verify_db\`;"
}
trap cleanup EXIT INT TERM
docker compose exec -T db mariadb -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "CREATE DATABASE \`$verify_db\`;"
gzip -dc "$archive" | docker compose exec -T db mariadb -uroot -p"${MYSQL_ROOT_PASSWORD}" "$verify_db"
table_count=$(docker compose exec -T db mariadb -N -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$verify_db';")
test "$table_count" -gt 20
echo "Restore verified in isolated database ($table_count tables)."
