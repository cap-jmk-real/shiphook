# Deployment recipes (copy/paste)

This page gives practical end-to-end setups for:

- Single app deployment
- Multiple apps/domains on one server with one `shiphook.service`

Each recipe includes DNS, server commands, `shiphook.yaml`, GitHub secrets, and GitHub Actions workflow.

---

## Recipe A: Single app deployment

### 1) Prerequisites

- Linux server with `sudo` (Debian/Ubuntu or RHEL-family)
- Domain name (example: `deploy.example.com`)
- App repo on GitHub
- SSH access to the server

### 2) DNS setup

Create an `A` record:

- Host: `deploy.example.com`
- Value: your server public IP
- TTL: default

Wait until DNS resolves:

```bash
nslookup deploy.example.com
```

### 3) Server setup

Install Node 22+, clone your app repo, install shiphook:

```bash
sudo apt update
sudo apt install -y curl git

# Install Node 22 (example using NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Clone app
sudo mkdir -p /srv/my-app
sudo chown "$USER":"$USER" /srv/my-app
git clone https://github.com/<your-org>/<your-repo>.git /srv/my-app

# Install shiphook globally
sudo npm install -g shiphook
```

Create `/srv/my-app/shiphook.yaml`:

```yaml
port: 3141
path: /
repoPath: /srv/my-app
runScript: npm run deploy
runTimeoutMs: 1800000
# secret: optional (omit to auto-generate into /srv/my-app/.shiphook.secret)
```

Start HTTPS + systemd setup (interactive):

```bash
cd /srv/my-app
shiphook setup-https
```

When prompted, provide:

- Domain: `deploy.example.com`
- Email: your email
- Local port: `3141`
- Webhook path: `/`

This sets up nginx + cert + `shiphook.service`.

### 4) GitHub repo secrets

In GitHub repo -> `Settings` -> `Secrets and variables` -> `Actions`, add:

- `SHIPHOOK_URL` = `https://deploy.example.com`
- `SHIPHOOK_SECRET` = your shiphook secret

If you omitted `secret` in YAML, get generated value from server:

```bash
cat /srv/my-app/.shiphook.secret
```

### 5) GitHub Actions workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Shiphook
        env:
          SHIPHOOK_URL: ${{ secrets.SHIPHOOK_URL }}
          SHIPHOOK_SECRET: ${{ secrets.SHIPHOOK_SECRET }}
        run: |
          BASE="${SHIPHOOK_URL%/}"
          curl -N -S -X POST "${BASE}/" \
            -H "X-Shiphook-Secret: ${SHIPHOOK_SECRET}" \
            -H "Content-Type: application/json" \
            -d '{}'
```

### 6) Verify

Push to `main`, then on server:

```bash
sudo systemctl status shiphook.service
sudo journalctl -u shiphook.service -f
```

---

## Recipe B: Multiple apps/domains on one server (one service)

This setup uses one running Shiphook process and one `shiphook.service` for many apps.

### 1) Prerequisites

- Same as Recipe A
- Multiple domains/subdomains, e.g.:
  - `hook.app1.com`
  - `hook.app2.com`

### 2) DNS setup

Create `A` records to the same server IP:

- `hook.app1.com` -> server IP
- `hook.app2.com` -> server IP

### 3) Server folders + repos

```bash
sudo mkdir -p /srv/shiphook /srv/app1 /srv/app2
sudo chown -R "$USER":"$USER" /srv/shiphook /srv/app1 /srv/app2

git clone https://github.com/<org>/<app1-repo>.git /srv/app1
git clone https://github.com/<org>/<app2-repo>.git /srv/app2
```

Install shiphook:

```bash
sudo npm install -g shiphook
```

Create `/srv/shiphook/shiphook.yaml`:

```yaml
port: 3141
apps:
  - name: app1
    host: hook.app1.com
    path: /deploy
    repoPath: /srv/app1
    runScript: npm run deploy
    runTimeoutMs: 1800000
    # secret: optional (auto-generated if omitted)
  - name: app2
    host: hook.app2.com
    path: /deploy
    repoPath: /srv/app2
    runScript: npm run deploy
    runTimeoutMs: 1800000
    # secret: optional (auto-generated if omitted)
```

Run HTTPS setup from `/srv/shiphook`:

```bash
cd /srv/shiphook
shiphook setup-https
```

If installer only configures one domain in your environment, add additional nginx server blocks manually that proxy to `http://127.0.0.1:3141` and preserve `Host`.

### 3b) nginx multi-domain sample config (copy/paste)

Create `/etc/nginx/sites-available/shiphook-multi.conf`:

```nginx
# App 1 domain
server {
  listen 80;
  server_name hook.app1.com;

  # Keep this path in sync with apps[].path for app1
  location /deploy {
    proxy_pass http://127.0.0.1:3141;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# App 2 domain
server {
  listen 80;
  server_name hook.app2.com;

  # Keep this path in sync with apps[].path for app2
  location /deploy {
    proxy_pass http://127.0.0.1:3141;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable and validate:

```bash
sudo ln -s /etc/nginx/sites-available/shiphook-multi.conf /etc/nginx/sites-enabled/shiphook-multi.conf
sudo nginx -t
sudo systemctl reload nginx
```

Add TLS certificates with Certbot:

```bash
sudo certbot --nginx -d hook.app1.com -d hook.app2.com --redirect
```

Important:

- Keep `proxy_set_header Host $host;` so Shiphook can route by host correctly.
- Keep `/deploy` aligned between nginx `location` and each app's `path` in `shiphook.yaml`.
- For long deploys, ensure nginx proxy timeouts are not too low (or use `shiphook setup-https`, which aligns timeout settings).

### 4) Per-app secret setup

If you omitted secrets in YAML, start once so secrets are generated:

```bash
cd /srv/shiphook
shiphook
```

Per-app secrets are persisted under each app repo `.shiphook/*.secret`.

List them:

```bash
ls /srv/app1/.shiphook
ls /srv/app2/.shiphook
```

Read each secret value:

```bash
cat /srv/app1/.shiphook/*.secret
cat /srv/app2/.shiphook/*.secret
```

### 5) GitHub secrets per repo

For each repo, add these GitHub Action secrets:

- App1 repo:
  - `SHIPHOOK_URL` = `https://hook.app1.com/deploy`
  - `SHIPHOOK_SECRET` = app1 secret
- App2 repo:
  - `SHIPHOOK_URL` = `https://hook.app2.com/deploy`
  - `SHIPHOOK_SECRET` = app2 secret

### 6) GitHub Actions workflow (each repo)

Use this in each repo (`.github/workflows/deploy.yml`):

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Shiphook app route
        env:
          SHIPHOOK_URL: ${{ secrets.SHIPHOOK_URL }}
          SHIPHOOK_SECRET: ${{ secrets.SHIPHOOK_SECRET }}
        run: |
          curl -N -S -X POST "${SHIPHOOK_URL}" \
            -H "X-Shiphook-Secret: ${SHIPHOOK_SECRET}" \
            -H "Content-Type: application/json" \
            -d '{}'
```

### 7) Verify and operations

```bash
sudo systemctl status shiphook.service
sudo journalctl -u shiphook.service -f
```

Behavior:

- Different apps can deploy concurrently.
- Deploys targeting the same app route are serialized.
- Secrets are isolated per app route (Host + path).

---

## Troubleshooting checklist

- **401 Unauthorized:** wrong `SHIPHOOK_SECRET` for that app route.
- **404 Not found:** wrong domain or path (Host+path must match config).
- **Webhook never arrives:** DNS/HTTPS not correct.
- **Deploy command fails:** check `.shiphook/logs/*.log` in target repo.
- **405/502 or conflicting server_name:** stale nginx or systemd state from previous setup attempts. During pipeline development, run `shiphook cleanup --domain <host>` (or `shiphook cleanup --all`) before re-running `shiphook setup-https`.
