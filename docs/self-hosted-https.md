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

The script will:

1. Install **nginx**, **certbot**, and the **certbot nginx** plugin (`apt` or `dnf`/`yum`).
2. Write an nginx site that reverse-proxies your domain + path to `http://127.0.0.1:<port>`.
3. Run **certbot** with the nginx plugin (`--redirect` to HTTPS).
4. Enable **Certbot auto-renew** via `certbot.timer` when the package provides it (common on systemd distros).

After setup, use your public URL in the Git host, for example:

`https://your-domain.example/` or `https://your-domain.example/webhook`

Keep Shiphook running on the same machine (same port), e.g. via systemd or a process manager:

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

## Security notes

- Prefer binding Shiphook to **localhost only** if you add that option, or use a firewall so only nginx can reach the Shiphook port.
- Your webhook **secret** must still be sent as `X-Shiphook-Secret` or `Authorization: Bearer …`; nginx forwards those by default.

---

## See also

- [Webhook setup](./webhooks) — GitHub/GitLab payload URL and secret.
- [Configuration](./config) — `port`, `path`, `SHIPHOOK_PATH`.
