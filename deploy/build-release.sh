#!/usr/bin/env bash
# Builds a ready-to-install EUNET release: deploy/out/eunet-<version>.tar.gz
# The bundle is pre-built (no compiler needed on the server) and runs on x64 and ARM64 Linux.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
VERSION=${1:-$(date -u +%Y.%m.%d)-$(git rev-parse --short HEAD 2>/dev/null || echo local)}
NAME=eunet-$VERSION
STAGE=$ROOT/deploy/out/$NAME
rm -rf "$STAGE" && mkdir -p "$STAGE"

echo "==> Building websites and games"
(cd showcase && npm ci --no-audit --no-fund && npm run build)

echo "==> Building portal"
(cd portal && npm ci --no-audit --no-fund && npm run vendor)
rm -rf portal/wwwroot/showcase && cp -r showcase/dist portal/wwwroot/showcase
# Framework-dependent and architecture-neutral: the same files run on x64 and ARM64
dotnet publish portal/Portal.csproj -c Release -o "$STAGE/app" --nologo -p:UseAppHost=false
rm -rf portal/wwwroot/showcase

echo "==> Adding installer"
cp deploy/install.sh deploy/eunet-backup.sh "$STAGE/"
cp deploy/INSTALL.md "$STAGE/README.md"
cp portal/README.md "$STAGE/PORTAL.md"
echo "$VERSION" > "$STAGE/VERSION"
chmod +x "$STAGE/install.sh" "$STAGE/eunet-backup.sh"

echo "==> Packing"
tar -C "$ROOT/deploy/out" -czf "$ROOT/deploy/out/$NAME.tar.gz" "$NAME"
(cd "$ROOT/deploy/out" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
du -h "$ROOT/deploy/out/$NAME.tar.gz" | cut -f1 | xargs echo "Release:" "deploy/out/$NAME.tar.gz" "size"
cat "$ROOT/deploy/out/$NAME.tar.gz.sha256"
