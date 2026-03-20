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
    # Reserved from /etc/os-release VERSION_ID for future distro-version-specific tweaks (e.g. package names).
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

# RHEL/Alma/Rocky/Fedora: SELinux blocks nginx (httpd_t) from connecting to unreserved ports (e.g. 3141).
# Without this, nginx error log shows: connect() to 127.0.0.1:PORT failed (13: Permission denied).
maybe_selinux_httpd_can_network_connect() {
  if ! command -v getenforce >/dev/null 2>&1; then
    return 0
  fi
  local en
  en=$(getenforce 2>/dev/null || true)
  [[ "$en" == "Enforcing" ]] || return 0
  if ! command -v setsebool >/dev/null 2>&1; then
    echo "Note: SELinux is Enforcing; if nginx returns 502 to upstream, run: sudo setsebool -P httpd_can_network_connect 1"
    return 0
  fi
  if command -v getsebool >/dev/null 2>&1; then
    if getsebool httpd_can_network_connect 2>/dev/null | grep -qE '[[:space:]]+on$'; then
      return 0
    fi
  fi
  echo "SELinux (Enforcing): enabling httpd_can_network_connect so nginx can proxy to Shiphook on 127.0.0.1…"
  setsebool -P httpd_can_network_connect 1 ||
    echo "Warning: setsebool failed; run manually: sudo setsebool -P httpd_can_network_connect 1"
}

have_systemd() {
  command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]
}

# Double-quote a string for use after ExecStart= in a systemd unit (escape \ and ").
systemd_quote_arg() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '"%s"' "$s"
}

# systemd WorkingDirectory= must be absolute; relative paths are resolved from / and break deploys.
# Prefer GNU realpath -m (works for missing final components); else readlink -f or cd+pwd for existing dirs.
absolutize_workdir_for_systemd() {
  local p=$1 out
  if command -v realpath >/dev/null 2>&1; then
    out=$(realpath -m -- "$p" 2>/dev/null) || true
    if [[ -n "$out" && "${out:0:1}" == "/" ]]; then
      printf '%s\n' "$out"
      return 0
    fi
  fi
  if [[ -d "$p" ]]; then
    if command -v readlink >/dev/null 2>&1; then
      out=$(readlink -f "$p" 2>/dev/null) || true
      if [[ -n "$out" && "${out:0:1}" == "/" ]]; then
        printf '%s\n' "$out"
        return 0
      fi
    fi
    printf '%s\n' "$(cd "$p" && pwd)"
    return 0
  fi
  if [[ "${p:0:1}" == "/" ]]; then
    printf '%s\n' "$p"
    return 0
  fi
  printf '%s\n' "$p"
  return 1
}

# Optional: SHIPHOOK_HTTPS_DEFAULTS_FILE (set by shiphook CLI) — last domain/email/port/path for this repo.
load_https_defaults_from_file() {
  DEFAULT_DOMAIN=""
  DEFAULT_EMAIL=""
  DEFAULT_PORT=""
  DEFAULT_WEBHOOK_PATH=""
  local f="${SHIPHOOK_HTTPS_DEFAULTS_FILE:-}"
  [[ -n "$f" && -r "$f" ]] || return 0
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" != *"="* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    case "$key" in
      DOMAIN) DEFAULT_DOMAIN="$val" ;;
      EMAIL) DEFAULT_EMAIL="$val" ;;
      PORT) DEFAULT_PORT="$val" ;;
      WEBHOOK_PATH) DEFAULT_WEBHOOK_PATH="$val" ;;
    esac
  done <"$f"
}

save_https_defaults_to_file() {
  local f="${SHIPHOOK_HTTPS_DEFAULTS_FILE:-}"
  [[ -n "$f" ]] || return 0
  local d tmp
  d=$(dirname "$f")
  mkdir -p "$d"
  umask 077
  tmp="${f}.tmp.$$"
  {
    echo "# Shiphook HTTPS setup — defaults for the next run in this repo (safe to edit)."
    echo "DOMAIN=$DOMAIN"
    echo "EMAIL=$EMAIL"
    echo "PORT=$PORT"
    echo "WEBHOOK_PATH=$WEBHOOK_PATH"
  } >"$tmp" && mv "$tmp" "$f"
  chmod 600 "$f" 2>/dev/null || true
  if [[ -n "${SUDO_USER:-}" ]]; then
    chown "${SUDO_USER}:${SUDO_USER}" "$f" "$d" 2>/dev/null || true
  fi
  echo ""
  echo "Saved HTTPS defaults for next run: ${f}"
}

load_os_release

echo "Shiphook HTTPS setup (nginx + Certbot)"
if [[ -n "${OS_PRETTY}" ]]; then
  if [[ -n "${OS_VERSION_ID}" ]]; then
    echo "Detected OS: ${OS_PRETTY} (${OS_VERSION_ID})"
  else
    echo "Detected OS: ${OS_PRETTY}"
  fi
fi
echo "Ensure DNS A/AAAA for your domain points to this server before continuing."
echo ""

load_https_defaults_from_file
if [[ -n "${DEFAULT_DOMAIN:-}${DEFAULT_EMAIL:-}${DEFAULT_PORT:-}${DEFAULT_WEBHOOK_PATH:-}" ]]; then
  echo "Loaded saved defaults (press Enter to keep [bracketed] values)."
  echo ""
fi

read -r -p "Domain (e.g. deploy.example.com) [${DEFAULT_DOMAIN:-}]: " DOMAIN
DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
read -r -p "Email for Let's Encrypt [${DEFAULT_EMAIL:-}]: " EMAIL
EMAIL="${EMAIL:-$DEFAULT_EMAIL}"
read -r -p "Local Shiphook port [${DEFAULT_PORT:-3141}]: " PORT
PORT="${PORT:-${DEFAULT_PORT:-3141}}"
read -r -p "Webhook URL path on this host [${DEFAULT_WEBHOOK_PATH:-/}]: " WEBHOOK_PATH
WEBHOOK_PATH="${WEBHOOK_PATH:-${DEFAULT_WEBHOOK_PATH:-/}}"

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

# --- Basic input validation to protect nginx config templating ---
# PORT: digits only, 1–65535
if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "Error: port must be numeric (got: '$PORT')."
  exit 1
fi
if (( PORT < 1 || PORT > 65535 )); then
  echo "Error: port must be between 1 and 65535 (got: $PORT)."
  exit 1
fi

# DOMAIN: letters, digits, dots, hyphens only
if ! [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Error: domain contains invalid characters (allowed: letters, digits, '.', '-')."
  exit 1
fi

# WEBHOOK_PATH: must start with / and only URL-safe path chars (no quotes/semicolons/whitespace)
if ! [[ "$WEBHOOK_PATH" =~ ^/[A-Za-z0-9._/-]*$ ]]; then
  echo "Error: webhook path contains invalid characters."
  echo "Allowed: '/', letters, digits, '.', '-', '_'. Got: '$WEBHOOK_PATH'"
  exit 1
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

# Align nginx upstream timeouts with Shiphook's configured deploy timeout.
# Shiphook's runTimeoutMs can be set via shiphook.yaml (default: 30 minutes).
# We add a buffer so streaming responses don't get cut off right at the boundary.
RUN_TIMEOUT_MS_RAW="${SHIPHOOK_RUN_TIMEOUT_MS:-1800000}"
PROXY_TIMEOUT_SEC=1800
if [[ "$RUN_TIMEOUT_MS_RAW" =~ ^[0-9]+$ ]]; then
  # buffer: +10 minutes
  PROXY_TIMEOUT_SEC=$((RUN_TIMEOUT_MS_RAW / 1000 + 600))
  if (( PROXY_TIMEOUT_SEC < 120 )); then
    PROXY_TIMEOUT_SEC=120
  fi
fi

COMMON_PROXY_SETTINGS="$(cat <<EOF
        proxy_connect_timeout ${PROXY_TIMEOUT_SEC}s;
        proxy_send_timeout ${PROXY_TIMEOUT_SEC}s;
        proxy_read_timeout ${PROXY_TIMEOUT_SEC}s;
        proxy_buffering off;
        proxy_request_buffering off;
EOF
)"

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
${COMMON_PROXY_SETTINGS}
    }
}
EOF
  ln -sf "$CONF_PATH" "${NGINX_SITES_ENABLED}/${SITE_NAME}"
  # Removing the default site can break other vhosts on shared servers. Opt-in only.
  if [[ -e "${NGINX_SITES_ENABLED}/default" ]]; then
    if [[ "${REMOVE_DEFAULT_SITE:-}" == "1" ]]; then
      echo "REMOVE_DEFAULT_SITE=1: removing ${NGINX_SITES_ENABLED}/default (may affect other sites on this host)."
      rm -f "${NGINX_SITES_ENABLED}/default"
    else
      echo "Note: ${NGINX_SITES_ENABLED}/default exists. If Certbot/nginx mis-picks the server block, remove it manually or re-run with REMOVE_DEFAULT_SITE=1 (see docs)."
    fi
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
${COMMON_PROXY_SETTINGS}
    }
}
EOF
fi

maybe_selinux_httpd_can_network_connect

nginx -t
if have_systemd; then
  systemctl enable nginx
  systemctl restart nginx
elif command -v service >/dev/null 2>&1; then
  echo "systemd not detected; using 'service nginx restart'."
  service nginx restart || service nginx start || echo "Warning: could not restart nginx via service."
else
  echo "Warning: could not detect systemd or 'service'; please ensure nginx is enabled and restarted manually."
fi

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
if have_systemd && systemctl list-unit-files 2>/dev/null | grep -q '^certbot\.timer'; then
  systemctl enable certbot.timer
  systemctl start certbot.timer
  echo ""
  echo "Certbot auto-renew enabled (systemd timer). Check: systemctl list-timers | grep -i certbot"
else
  echo ""
  echo "Note: certbot.timer not found or systemd not detected. Renewals may use cron; verify with: certbot renew --dry-run"
fi

install_shiphook_systemd_unit() {
  local workdir="${SHIPHOOK_SYSTEMD_WORKING_DIRECTORY:-}"
  local node_bin="${SHIPHOOK_SYSTEMD_NODE_BIN:-}"
  local cli_js="${SHIPHOOK_SYSTEMD_CLI_JS:-}"

  if [[ -z "$workdir" || -z "$node_bin" || -z "$cli_js" ]]; then
    echo ""
    echo "Skipping shiphook.service (set SHIPHOOK_SYSTEMD_* env from the Shiphook CLI for automatic install)."
    return 0
  fi

  local resolved
  resolved=$(absolutize_workdir_for_systemd "$workdir") || true
  workdir=$resolved
  if [[ "${workdir:0:1}" != "/" ]]; then
    echo ""
    echo "Warning: Working directory must be an absolute path for systemd (could not resolve: ${SHIPHOOK_SYSTEMD_WORKING_DIRECTORY:-?}). shiphook.service not installed — see docs/systemd.md."
    return 0
  fi

  if ! have_systemd; then
    echo ""
    echo "Skipping shiphook.service (systemd not available)."
    return 0
  fi

  if [[ ! -d "$workdir" ]]; then
    echo ""
    echo "Warning: Working directory does not exist: ${workdir} — shiphook.service not installed."
    return 0
  fi

  if [[ "$node_bin" == *'"'* ]] || [[ "$cli_js" == *'"'* ]]; then
    echo ""
    echo "Warning: node or CLI path contains a double quote; install shiphook.service manually (see docs/systemd.md)."
    return 0
  fi

  local svc_user svc_group
  if [[ -n "${SUDO_USER:-}" ]]; then
    svc_user="$SUDO_USER"
    svc_group=$(id -gn "$SUDO_USER" 2>/dev/null || echo "$svc_user")
  else
    svc_user="root"
    svc_group="root"
  fi

  local unit_path="/etc/systemd/system/shiphook.service"
  local exec_line
  exec_line="ExecStart=$(systemd_quote_arg "$node_bin") $(systemd_quote_arg "$cli_js")"

  echo ""
  echo "Installing Shiphook systemd unit (${unit_path})…"
  umask 022
  cat >"$unit_path" <<UNITEOF
[Unit]
Description=Shiphook deploy webhook
After=network-online.target nginx.service
Wants=network-online.target

[Service]
Type=simple
User=${svc_user}
Group=${svc_group}
WorkingDirectory=${workdir}
${exec_line}
Restart=on-failure
RestartSec=5s
Environment=SHIPHOOK_SKIP_HTTPS_PROMPT=1
Environment=SHIPHOOK_PORT=${PORT}
Environment=SHIPHOOK_PATH=${WEBHOOK_PATH}

[Install]
WantedBy=multi-user.target
UNITEOF

  systemctl daemon-reload
  systemctl enable shiphook.service
  if systemctl restart shiphook.service; then
    echo "shiphook.service enabled and started."
    echo "  Logs: journalctl -u shiphook.service -f"
  else
    echo "Warning: shiphook.service failed to start (is port ${PORT} already in use?). Check: journalctl -u shiphook.service -n 50"
    return 0
  fi
}

install_shiphook_systemd_unit

save_https_defaults_to_file

echo ""
echo "Done."
echo "  Public webhook URL: https://${DOMAIN}${WEBHOOK_PATH}"
echo "  Proxy -> http://127.0.0.1:${PORT}${WEBHOOK_PATH}"
echo "GitHub webhook payload URL must use https:// (and your secret header as configured)."
