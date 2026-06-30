#!/usr/bin/env bash
# localDbBackup.sh
#
# Creates a compressed mongodump archive and prunes backups older than
# RETENTION_DAYS. Intended to run inside the mongo-backup container.
#
# Environment variables:
#   MONGO_HOST       - MongoDB host (default: mongo)
#   MONGO_PORT       - MongoDB port (default: 27017)
#   BACKUP_DIR       - Directory to store backups (default: /backups)
#   RETENTION_DAYS   - Days to keep backups (default: 7)

set -euo pipefail

MONGO_HOST="${MONGO_HOST:-mongo}"
MONGO_PORT="${MONGO_PORT:-27017}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)
ARCHIVE_NAME="ems_mongo_${TIMESTAMP}.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting local MongoDB backup..."

mongodump \
  --host "${MONGO_HOST}" \
  --port "${MONGO_PORT}" \
  --archive="${ARCHIVE_PATH}" \
  --gzip

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup written: ${ARCHIVE_PATH}"

# Prune old backups
DELETED=$(find "${BACKUP_DIR}" -maxdepth 1 -name 'ems_mongo_*.gz' -type f -mtime +"${RETENTION_DAYS}" -print -delete)
if [ -n "${DELETED}" ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Pruned old backups:"
  echo "${DELETED}"
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup job complete."
