#!/bin/sh
set -eu

backup_root=${BACKUP_ROOT:-./backups}
retention_days=${BACKUP_RETENTION_DAYS:-14}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$backup_root/$timestamp"
mkdir -p "$destination"
chmod 700 "$destination"

docker compose exec -T db sh -c \
  'mariadb-dump --single-transaction --routines --events -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' \
  | gzip -9 > "$destination/database.sql.gz"
docker run --rm --user "$(id -u):$(id -g)" -v vigion_minio_data:/source:ro -v "$PWD/$destination:/backup" alpine:3.20 \
  tar -C /source -czf /backup/minio-data.tar.gz .
sha256sum "$destination/database.sql.gz" "$destination/minio-data.tar.gz" > "$destination/SHA256SUMS"
chmod 600 "$destination/database.sql.gz" "$destination/minio-data.tar.gz" "$destination/SHA256SUMS"
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -mtime "+$retention_days" -exec rm -rf -- {} +
echo "Backup completed: $destination"
