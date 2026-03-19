# Running Shiphook as a systemd service

After HTTPS + nginx are set up, you’ll usually want Shiphook to run **in the background**, survive SSH disconnects, and start on boot. On most modern Linux distros (including AlmaLinux), use **systemd**.

The automated **`shiphook setup-https`** script (and interactive **`shiphook`** when you answer **`y`** to HTTPS) **writes** `/etc/systemd/system/shiphook.service`, reloads systemd, and runs **`systemctl enable --now shiphook.service`** when systemd is available and the CLI passes the install path (normal `sudo` flow).

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

