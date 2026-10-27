#!/usr/bin/env bash
# EUNET installer for a fresh Ubuntu 22.04/24.04 or Debian 12 VM. Run from the unpacked release as root:
#   sudo ./install.sh --domain portal.example.com --email you@example.com
#   sudo ./install.sh                     # no domain: HTTPS with a self-signed certificate on the VM's IP
#   sudo ./install.sh --with-ai --model qwen2.5:3b
# Re-running it upgrades the app and keeps all data.
set -euo pipefail

DOMAIN="" EMAIL="" WITH_AI=0 MODEL="qwen2.5:3b" ADMIN_PASSWORD="${EUNET_ADMIN_PASSWORD:-}" NO_FIREWALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN=$2; shift 2 ;;
    --email) EMAIL=$2; shift 2 ;;
    --with-ai) WITH_AI=1; shift ;;
    --model) MODEL=$2; shift 2 ;;
    --admin-password) ADMIN_PASSWORD=$2; shift 2 ;;
    --no-firewall) NO_FIREWALL=1; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo $0 $*" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/app/Portal.dll" ] || { echo "Run this from the unpacked release folder (app/Portal.dll not found)." >&2; exit 1; }
HAS_SYSTEMD=0; [ -d /run/systemd/system ] && HAS_SYSTEMD=1
step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

step "Installing packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl tar gzip openssl >/dev/null
if ! apt-get install -y -qq aspnetcore-runtime-10.0 >/dev/null 2>&1; then
  # Older releases don't carry .NET 10 yet: use Microsoft's official install script
  echo "aspnetcore-runtime-10.0 not in this distribution's repositories; installing from Microsoft"
  curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --channel 10.0 --runtime aspnetcore --install-dir /usr/share/dotnet >/dev/null
  ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet
fi
apt-get install -y -qq caddy >/dev/null
dotnet --list-runtimes | grep -q "Microsoft.AspNetCore.App 10." || { echo "ASP.NET Core 10 runtime missing after install" >&2; exit 1; }

step "Creating user and folders"
id eunet >/dev/null 2>&1 || useradd --system --home /var/lib/eunet --shell /usr/sbin/nologin eunet
install -d -o eunet -g eunet -m 750 /var/lib/eunet /var/backups/eunet
install -d -m 755 /opt/eunet /etc/eunet

step "Installing the app ($(cat "$HERE/VERSION" 2>/dev/null || echo unknown))"
rm -rf /opt/eunet/app.new && cp -r "$HERE/app" /opt/eunet/app.new
[ -d /opt/eunet/app ] && rm -rf /opt/eunet/app.old && mv /opt/eunet/app /opt/eunet/app.old
mv /opt/eunet/app.new /opt/eunet/app
install -m 755 "$HERE/eunet-backup.sh" /usr/local/bin/eunet-backup

# Settings live in one root-owned file; the first-run admin password is only used until users.json exists
if [ ! -f /etc/eunet/eunet.env ]; then
  [ -n "$ADMIN_PASSWORD" ] || ADMIN_PASSWORD=$(openssl rand -base64 18 | tr '+/' 'xy' | tr -d '=')
  cat > /etc/eunet/eunet.env <<EOF
ASPNETCORE_URLS=http://127.0.0.1:5000
DataDir=/var/lib/eunet
TrustForwardedHeaders=true
EUNET_ADMIN_PASSWORD=$ADMIN_PASSWORD
Ollama__Url=http://127.0.0.1:11434
Ollama__Model=$MODEL
EOF
  chmod 600 /etc/eunet/eunet.env
  NEW_PASSWORD=$ADMIN_PASSWORD
fi

step "Setting up the service"
cat > /etc/systemd/system/eunet.service <<'EOF'
[Unit]
Description=EUNET Portal
After=network-online.target
Wants=network-online.target

[Service]
User=eunet
Group=eunet
WorkingDirectory=/opt/eunet/app
EnvironmentFile=/etc/eunet/eunet.env
ExecStart=/usr/bin/dotnet /opt/eunet/app/Portal.dll
Restart=always
RestartSec=5
# Hardening: read-only system, private /tmp, no new privileges, only the data folder is writable
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=/var/lib/eunet
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/eunet-backup.service <<'EOF'
[Unit]
Description=EUNET daily backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/eunet-backup
EOF
cat > /etc/systemd/system/eunet-backup.timer <<'EOF'
[Unit]
Description=EUNET daily backup
[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=30m
Persistent=true
[Install]
WantedBy=timers.target
EOF

step "Setting up HTTPS (Caddy)"
if [ -n "$DOMAIN" ]; then
  SITE=$DOMAIN; TLS=${EMAIL:+"tls $EMAIL"}
else
  # No domain: serve on the public IP with Caddy's own certificate (browsers will warn until you add a domain)
  IP=$(curl -fsS --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')
  SITE="https://$IP, https://localhost"; TLS="tls internal"
fi
cat > /etc/caddy/Caddyfile <<EOF
$SITE {
	$TLS
	encode zstd gzip
	request_body {
		max_size 100MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
	reverse_proxy 127.0.0.1:5000
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
  || { caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; echo "Caddy config is invalid" >&2; exit 1; }

if [ "$WITH_AI" -eq 1 ]; then
  step "Installing the local AI (Ollama + $MODEL)"
  command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh
fi

if [ "$NO_FIREWALL" -eq 0 ] && command -v ufw >/dev/null; then
  step "Firewall: allowing SSH, HTTP and HTTPS only"
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

if [ "$HAS_SYSTEMD" -eq 1 ]; then
  step "Starting"
  systemctl daemon-reload
  systemctl enable --now eunet.service eunet-backup.timer >/dev/null
  systemctl restart eunet.service caddy.service
  [ "$WITH_AI" -eq 1 ] && { systemctl enable --now ollama >/dev/null 2>&1 || true; sleep 3; ollama pull "$MODEL"; }
  for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:5000/login.html && break; sleep 1; done
  curl -fsS -o /dev/null http://127.0.0.1:5000/login.html || { journalctl -u eunet -n 30 --no-pager; echo "The portal didn't start; see the log above." >&2; exit 1; }
  rm -rf /opt/eunet/app.old
else
  echo "systemd isn't running here, so nothing was started. Start manually with:"
  echo "  set -a; . /etc/eunet/eunet.env; set +a; sudo -E -u eunet dotnet /opt/eunet/app/Portal.dll"
fi

step "Done"
echo "Open:      https://${DOMAIN:-$IP}"
echo "Sign in:   admin"
[ -n "${NEW_PASSWORD:-}" ] && echo "Password:  $NEW_PASSWORD   (shown once; change it under My account)"
[ -z "$DOMAIN" ] && echo "Note:      no domain given, so the browser will warn about the certificate. Re-run with --domain to fix."
echo "Logs:      journalctl -u eunet -f"
echo "Backups:   /var/backups/eunet (daily, last 14 kept). Settings: /etc/eunet/eunet.env"
