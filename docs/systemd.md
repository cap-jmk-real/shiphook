# Running Shiphook as a systemd service

After HTTPS + nginx are set up, you’ll usually want Shiphook to run **in the background**, survive SSH disconnects, and start on boot. On most modern Linux distros (including AlmaLinux), use **systemd**.

The automated **`shiphook setup-https`** script (and interactive **`shiphook`** when you answer **`y`** to HTTPS) creates a per-domain unit at `/etc/systemd/system/shiphook-<domain>.service` (long domains are safely truncated+hashed), reloads systemd, and runs **`systemctl enable --now <unit>.service`** when systemd is available and the CLI passes the install path (normal `sudo` flow).

If the unit already exists, setup-https leaves it unchanged by default so re-running setup does not reinstall the service. To force reinstall/restart from setup, set `SHIPHOOK_REINSTALL_SYSTEMD=1`.

If **`shiphook.service` is already active**, running `shiphook` again will **restart** the systemd unit (so config changes are applied).

When **systemd starts `shiphook.service`**, the CLI won't try to restart it again (avoids restart loops). Running `shiphook` manually from an interactive terminal can restart the unit so the service comes up with updated config.

---

## Example service unit

Assuming:

- Your repo lives at `/srv/my-app` (replace with **your** repo path)
- You want the default Shiphook port (`3141`) and path (`/`)

Create `/etc/systemd/system/shiphook.service` as root:

```ini
[Unit]
Description=Shiphook deploy webhook
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/my-app
ExecStart=/usr/bin/env shiphook
Restart=on-failure
RestartSec=5s

# Optional: environment overrides
Environment=SHIPHOOK_PORT=3141
# Environment=SHIPHOOK_PATH=/webhook
# Environment=SHIPHOOK_RUN_SCRIPT=npm run deploy

[Install]
WantedBy=multi-user.target
```

Then reload and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shiphook.service
sudo systemctl status shiphook.service
```

Shiphook now:

- Runs in the background
- Starts on boot
- Is proxied by nginx+Certbot on HTTPS (from the HTTPS setup docs)

---

## Notes

- Set **WorkingDirectory** to the repo where Shiphook should run (and where `shiphook.yaml` lives). This is usually the same directory you `cd` into before running `shiphook` manually.
- Create a non-privileged user for the service (for example, `shiphook`) and ensure that repo directory is owned/readable by that user:

  ```bash
  sudo useradd --system --shell /usr/sbin/nologin --home /nonexistent shiphook
  sudo chown -R shiphook:shiphook /srv/my-app
  ```

- Use `journalctl -u shiphook.service` to inspect logs (including deploys and secrets setup).
- You can still run `shiphook deploy` manually to trigger one-off deploys; it doesn’t interfere with the service.

## One service, multiple apps/domains

You can run either one process for many apps (recommended) or one service per app/domain:

- **Single process mode:** one unit with `apps:` config handles many repos/domains.
- **Per-app mode:** one `shiphook-<domain>.service` per repo/domain, each on its own port.

`shiphook.service` (or a custom unit name) can run a single Shiphook process that serves multiple apps via `apps:` config. This is the recommended way to host multiple repos/domains on one server:

- one `shiphook.service`
- one Shiphook process
- multiple app routes (`host` + `path`)
- one secret per app

Different apps can deploy concurrently; deploys for the same app are serialized.

