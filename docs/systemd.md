# Running Shiphook as a systemd service

After HTTPS + nginx are set up, you’ll usually want Shiphook to run **in the background**, survive SSH disconnects, and start on boot. On most modern Linux distros (including AlmaLinux), use **systemd**.

---

## Example service unit

Assuming:

- Your repo lives at `/opt/majico`
- You want the default Shiphook port (`3141`) and path (`/`)

Create `/etc/systemd/system/shiphook.service` as root:

```ini
[Unit]
Description=Shiphook deploy webhook
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/majico
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

- Keep the **WorkingDirectory** pointed at the repo where Shiphook should run (and where `shiphook.yaml` lives).
- Use `journalctl -u shiphook.service` to inspect logs (including deploys and secrets setup).
- You can still run `shiphook deploy` manually to trigger one-off deploys; it doesn’t interfere with the service.

