# HTTPS with nginx and Certbot

GitHub (and many other hosts) require a **public HTTPS** URL for webhooks. Shiphook itself only serves HTTP on a local port; use a reverse proxy (e.g. **nginx**) and **Let’s Encrypt** (via **Certbot**) on your server.

---

## Automated setup (Linux)

On a Debian/Ubuntu or **RHEL-family** server — **AlmaLinux**, Rocky Linux, RHEL, CentOS Stream, Fedora, etc. — (as a user with `sudo`):

The installer **auto-detects** the OS from `/etc/os-release` and picks `apt` vs `dnf`/`yum`. On AlmaLinux / Rocky / CentOS / RHEL it also installs **EPEL** when needed for Certbot and opens **firewalld** HTTP/HTTPS if firewalld is running.

```bash
shiphook setup-https
```

When you run plain **`shiphook`** on an **interactive Linux terminal**, Shiphook **asks** whether you want to run this HTTPS setup first. Answer **`y`** to run it (uses `sudo`), or **`N`** (default) to skip and start the HTTP server only.

For **systemd**, **CI**, or other non-interactive runs, the question is skipped automatically. To force skipping in a TTY session, set:

`SHIPHOOK_SKIP_HTTPS_PROMPT=1`

---

The setup script will **prompt** for:

| Prompt | Purpose |
|--------|---------|
| **Domain** | FQDN that points at this server (DNS A/AAAA must be set first). |
| **Email** | Let’s Encrypt account / expiry notices. |
| **Local Shiphook port** | Port Shiphook listens on (default `3141`). |
| **Webhook path** | URL path nginx proxies (default `/`, same as `SHIPHOOK_PATH` / `shiphook.yaml` `path`). |

When you run **`shiphook setup-https`** or interactive **`shiphook`** → HTTPS **`y`** from a repo directory, the CLI passes **`SHIPHOOK_HTTPS_DEFAULTS_FILE`** pointing at **`.shiphook/setup-https.defaults`** in that repo. After a **successful** run, the script **writes** that file (domain, email, port, path); the **next** run **pre-fills** the prompts (press **Enter** to accept). The file is listed in **`.gitignore`** so it stays local (optional: commit a template without secrets if your team wants shared defaults).

**Optional (Debian/Ubuntu only):** if nginx’s default site (`sites-enabled/default`) would interfere with Certbot, you can opt in to removing it by running the setup with `REMOVE_DEFAULT_SITE=1` (e.g. `sudo REMOVE_DEFAULT_SITE=1 bash …/setup-https.sh`). Without that, the script only prints a note and leaves `default` in place so shared servers are not surprised.

The script will:

1. Install **nginx**, **certbot**, and the **certbot nginx** plugin (`apt` or `dnf`/`yum`).
2. Write an nginx site that reverse-proxies your domain + path to `http://127.0.0.1:<port>`.
3. Run **certbot** with the nginx plugin (`--redirect` to HTTPS).
4. Enable **Certbot auto-renew** via `certbot.timer` when the package provides it (common on systemd distros).
5. When the CLI passes bootstrap variables (interactive **`shiphook`** answering **`y`**, or **`shiphook setup-https`**), install **`shiphook.service`** on **systemd** hosts: `WorkingDirectory` is your resolved repo path, `ExecStart` uses the same Node + `dist/cli.js` as this run, `SHIPHOOK_SKIP_HTTPS_PROMPT=1`, and the port/path you entered. Then **`systemctl enable --now shiphook`**.

After **`shiphook setup-https`**, or after interactive **`shiphook`** with HTTPS **`y`**, the CLI **prints the webhook secret (TTY)** and **exits** — Shiphook stays up via **`shiphook.service`**, not in the foreground.

Use your public URL in the Git host, for example:

`https://your-domain.example/` or `https://your-domain.example/webhook`

To run in the foreground only (no systemd), skip HTTPS setup or use **`SHIPHOOK_SKIP_HTTPS_PROMPT=1`**, then:

```bash
cd /path/to/your/repo
shiphook
```

---

## Manual / other operating systems

If you are not on Linux or prefer manual control:

1. Point DNS at the server.
2. Configure nginx `proxy_pass` to `http://127.0.0.1:3141` (or your port), preserving the request path and headers (`Host`, `X-Forwarded-Proto`, etc.).
3. Obtain a certificate: `certbot --nginx -d your.domain ...`
4. Ensure renewal: `certbot renew` (cron or `certbot.timer`).

---

## SELinux (AlmaLinux, Rocky, RHEL, Fedora, …)

If nginx returns **502** and `/var/log/nginx/error.log` shows **`connect() to 127.0.0.1:3141 failed (13: Permission denied)`**, SELinux is blocking nginx from opening outbound TCP to your Shiphook port. The automated **`setup-https.sh`** enables **`httpd_can_network_connect`** when **`getenforce`** is **Enforcing**. To fix manually:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

Confirm with `getsebool httpd_can_network_connect` (should show **on**). Audit denials look like **`name_connect`** / **`dest=3141`** / **`httpd_t`** → **`unreserved_port_t`**.

---

## Security notes

- Shiphook’s HTTP server listens on **all interfaces** by default (not localhost-only). Limit who can reach it: run **behind nginx** (as this guide sets up) and/or use a **host firewall** so only `127.0.0.1` or your proxy can reach the Shiphook port from the network.
- Your webhook **secret** must still be sent as `X-Shiphook-Secret` or `Authorization: Bearer …`; nginx forwards those by default.

---

## See also

- [Webhook setup](./webhooks) — GitHub/GitLab payload URL and secret.
- [Configuration](./config) — `port`, `path`, `SHIPHOOK_PATH`.
