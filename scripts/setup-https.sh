#!/usr/bin/env bash
# Shiphook HTTPS setup: nginx reverse proxy + Let's Encrypt (Certbot) + auto-renew.
# Run on the server as root: sudo bash scripts/setup-https.sh
# Or: shiphook setup-https (invokes sudo for you on Linux)

set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "This script must run as root. Use: sudo $0"
  exit 1
fi

# --- OS auto-detection (/etc/os-release) ---
OS_ID=""
OS_VERSION_ID=""
OS_PRETTY=""
ID_LIKE_VALUE=""

load_os_release() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-}"
    OS_VERSION_ID="${VERSION_ID:-}"
    OS_PRETTY="${PRETTY_NAME:-${OS_ID:-unknown}}"
    ID_LIKE_VALUE="${ID_LIKE:-}"
  fi
}

is_debian_family() {
  case "${OS_ID}" in
    debian|ubuntu|linuxmint|pop|raspbian|kali|zorin) return 0 ;;
  esac
  [[ "${ID_LIKE_VALUE}" == *"debian"* ]] || [[ "${ID_LIKE_VALUE}" == *"ubuntu"* ]]
}

is_rhel_family() {
  case "${OS_ID}" in
    almalinux|rocky|rhel|centos|fedora|ol|oraclelinux|virtuozzo|sangoma|cloudlinux) return 0 ;;
  esac
  [[ "${ID_LIKE_VALUE}" == *"rhel"* ]] || [[ "${ID_LIKE_VALUE}" == *"fedora"* ]] || [[ "${ID_LIKE_VALUE}" == *"centos"* ]]
}

ensure_epel_if_needed() {
  # Fedora uses its own repos; Alma/Rocky/CentOS/RHEL often need EPEL for certbot extras.
  case "${OS_ID}" in
    almalinux|rocky|centos|rhel|ol|oraclelinux)
      if command -v rpm >/dev/null 2>&1 && ! rpm -q epel-release >/dev/null 2>&1; then
        echo "Installing EPEL release (recommended for Certbot on ${OS_ID})..."
        (command -v dnf >/dev/null 2>&1 && dnf install -y epel-release) ||
          (command -v yum >/dev/null 2>&1 && yum install -y epel-release) ||
          echo "Warning: could not install epel-release; Certbot install may fail."
      fi
      ;;
  esac
}

maybe_open_firewalld() {
  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
    echo "Opening HTTP/HTTPS in firewalld (for ACME and GitHub webhooks)..."
    firewall-cmd --permanent --add-service=http --add-service=https
    firewall-cmd --reload
  fi
}

load_os_release

echo "Shiphook HTTPS setup (nginx + Certbot)"
if [[ -n "${OS_PRETTY}" ]]; then
  echo "Detected OS: ${OS_PRETTY}"
fi
echo "Ensure DNS A/AAAA for your domain points to this server before continuing."
echo ""

read -r -p "Domain (e.g. deploy.example.com): " DOMAIN
read -r -p "Email for Let's Encrypt (required for expiry notices): " EMAIL
read -r -p "Local Shiphook port [3141]: " PORT
PORT="${PORT:-3141}"
read -r -p "Webhook URL path on this host [/]: " WEBHOOK_PATH
WEBHOOK_PATH="${WEBHOOK_PATH:-/}"

DOMAIN="${DOMAIN//[[:space:]]/}"
EMAIL="${EMAIL//[[:space:]]/}"

if [[ -z "$DOMAIN" ]]; then
  echo "Error: domain is required."
  exit 1
fi
if [[ -z "$EMAIL" ]] || [[ "$EMAIL" != *"@"* ]]; then
  echo "Error: a valid email address is required."
  exit 1
fi

# Normalize path: must start with /
if [[ "${WEBHOOK_PATH:0:1}" != "/" ]]; then
  WEBHOOK_PATH="/${WEBHOOK_PATH}"
fi

install_packages_debian() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y nginx certbot python3-certbot-nginx
}

install_packages_rhel() {
  dnf install -y nginx certbot python3-certbot-nginx || yum install -y nginx certbot python3-certbot-nginx
}

if is_debian_family && command -v apt-get >/dev/null 2>&1; then
  echo "Installing nginx and certbot (apt, Debian family)..."
  install_packages_debian
elif is_rhel_family && { command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; }; then
  ensure_epel_if_needed
  maybe_open_firewalld
  echo "Installing nginx and certbot (dnf/yum, RHEL family — e.g. AlmaLinux, Rocky, RHEL, CentOS, Fedora)..."
  install_packages_rhel
elif command -v apt-get >/dev/null 2>&1; then
  echo "Installing nginx and certbot (apt, fallback)..."
  install_packages_debian
elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
  ensure_epel_if_needed
  maybe_open_firewalld
  echo "Installing nginx and certbot (dnf/yum, fallback)..."
  install_packages_rhel
else
  echo "Unsupported OS: need apt-get or dnf/yum (Debian/Ubuntu or RHEL-family such as AlmaLinux)."
  echo "Configure nginx + certbot manually; see docs."
  exit 1
fi

# Debian/Ubuntu style
NGINX_SITES_AVAILABLE="/etc/nginx/sites-available"
NGINX_SITES_ENABLED="/etc/nginx/sites-enabled"
NGINX_CONF_D="/etc/nginx/conf.d"
SITE_NAME="shiphook"

if [[ -d "$NGINX_SITES_AVAILABLE" ]]; then
  CONF_PATH="${NGINX_SITES_AVAILABLE}/${SITE_NAME}"
  mkdir -p "$NGINX_SITES_AVAILABLE" "$NGINX_SITES_ENABLED"
  cat >"$CONF_PATH" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location ${WEBHOOK_PATH} {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sf "$CONF_PATH" "${NGINX_SITES_ENABLED}/${SITE_NAME}"
  # Remove default site if it steals this server_name (optional)
  if [[ -e "${NGINX_SITES_ENABLED}/default" ]]; then
    rm -f "${NGINX_SITES_ENABLED}/default"
  fi
else
  # RHEL/Fedora: conf.d
  CONF_PATH="${NGINX_CONF_D}/${SITE_NAME}.conf"
  mkdir -p "$NGINX_CONF_D"
  cat >"$CONF_PATH" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location ${WEBHOOK_PATH} {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
fi

nginx -t
systemctl enable nginx
systemctl restart nginx

echo ""
echo "Requesting TLS certificate (Certbot + nginx plugin)..."
certbot --nginx \
  -d "$DOMAIN" \
  -m "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  --redirect

# Auto-renew: systemd timer (Debian/Ubuntu/RHEL certbot packages)
if systemctl list-unit-files 2>/dev/null | grep -q '^certbot\.timer'; then
  systemctl enable certbot.timer
  systemctl start certbot.timer
  echo ""
  echo "Certbot auto-renew enabled (systemd timer). Check: systemctl list-timers | grep -i certbot"
else
  echo ""
  echo "Note: certbot.timer not found. Renewals may use cron; verify with: certbot renew --dry-run"
fi

echo ""
echo "Done."
echo "  Public webhook URL: https://${DOMAIN}${WEBHOOK_PATH}"
echo "  Proxy -> http://127.0.0.1:${PORT}${WEBHOOK_PATH}"
echo "Run Shiphook on this machine (same port):  shiphook"
echo "GitHub webhook payload URL must use https:// (and your secret header as configured)."
