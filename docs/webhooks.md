# Webhook setup

Shiphook accepts a simple POST. Configure your Git host to send that POST when you push.

## GitHub

1. Repo → **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL:** `https://your-server:3141/` (use your Shiphook URL; if you set `SHIPHOOK_PATH`, use that path).
3. **Content type:** `application/json`.
4. **Secret:** (optional) Set the same value as `SHIPHOOK_SECRET` so only GitHub can trigger your deploy.
5. **Events:** “Just the push event” is enough.
6. Save.

On push, GitHub will POST to your URL. Shiphook will run `git pull` and your script.

## GitLab

1. Repo → **Settings** → **Webhooks**.
2. **URL:** your Shiphook URL.
3. **Secret token:** (optional) same as `SHIPHOOK_SECRET`.
4. Trigger: **Push events**.
5. Add webhook.

## Generic

Any service that can send an HTTP POST will work. Send:

- **Method:** POST  
- **URL:** `http://your-server:3141/` (or your `SHIPHOOK_PATH`)  
- **Header (if you use a secret):** `X-Shiphook-Secret: your-secret` or `Authorization: Bearer your-secret`

## Response

Shiphook always returns **200** with a JSON body:

```json
{
  "ok": true,
  "pull": { "success": true, "stdout": "...", "stderr": "" },
  "run": { "stdout": "...", "stderr": "", "exitCode": 0 },
  "error": null
}
```

If the run script exits non-zero, `ok` is `false` and `run.exitCode` is the exit code. Use this to monitor or alert (e.g. from GitHub Actions or Uptime Robot).
