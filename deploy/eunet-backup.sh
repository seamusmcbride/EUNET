#!/usr/bin/env bash
# Backs up EUNET data (users, documents, audit log, settings) and keeps the newest 14 archives.
set -euo pipefail
DEST=${EUNET_BACKUP_DIR:-/var/backups/eunet}
STAMP=$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$DEST"
tar -czf "$DEST/eunet-$STAMP.tar.gz" -C / var/lib/eunet etc/eunet
chmod 600 "$DEST/eunet-$STAMP.tar.gz"
ls -1t "$DEST"/eunet-*.tar.gz | tail -n +15 | xargs -r rm -f
echo "Backup written: $DEST/eunet-$STAMP.tar.gz"
