# Webhook setup

Shiphook is triggered by an **HTTP POST** to its URL. You configure your Git host (or any service) to send that POST when you push. No special payload format is required — Shiphook only cares that the request is POST and, if you set a secret, that the secret is sent.

---

## What Shiphook expects

- **Method:** `POST`
- **URL:** Your Shiphook base URL + path (e.g. `http://your-server:3141/` or `http://your-server:3141/webhook` if `SHIPHOOK_PATH=/webhook`)
- **Optional auth:** If `SHIPHOOK_SECRET` is set, include it in one of:
  - Header: `X-Shiphook-Secret: <secret>`
  - Header: `Authorization: Bearer <secret>`

Shiphook does not validate payload content (e.g. GitHub payload). It runs `git pull` and the run script on every authorized POST.

---

## GitHub

1. Open your repo → **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL:** Your Shiphook URL (e.g. `https://your-server:3141/` or your custom path).
3. **Content type:** `application/json`.
4. **Secret:** (optional) Use the same value as `SHIPHOOK_SECRET` so only GitHub can trigger the deploy.
5. **Which events:** “Just the push event” is enough.
6. Save.

On every push, GitHub sends a POST to that URL. Shiphook runs `git pull` and your run script.

---

## GitLab

1. Open your repo → **Settings** → **Webhooks**.
2. **URL:** Your Shiphook URL.
3. **Secret token:** (optional) Same value as `SHIPHOOK_SECRET`.
4. **Trigger:** Push events.
5. Add webhook.

---

## Generic: any HTTP client

Any service that can send an HTTP POST works. Example with curl:

```bash
curl -X POST http://your-server:3141/
```

With a secret:

```bash
curl -X POST http://your-server:3141/ \
  -H "X-Shiphook-Secret: your-secret"
```

Or:

```bash
curl -X POST http://your-server:3141/ \
  -H "Authorization: Bearer your-secret"
```

---

## What Shiphook returns

Shiphook **always responds with HTTP 200** and a JSON body. The body describes whether the run script succeeded and includes pull and run output.

**Success (run script exited 0):**

```json
{
  "ok": true,
  "pull": {
    "success": true,
    "stdout": "...",
    "stderr": ""
  },
  "run": {
    "stdout": "...",
    "stderr": "",
    "exitCode": 0
  },
  "error": null
}
```

**Failure (run script exited non-zero):**

```json
{
  "ok": false,
  "pull": { "success": true, "stdout": "...", "stderr": "" },
  "run": {
    "stdout": "...",
    "stderr": "...",
    "exitCode": 1
  },
  "error": null
}
```

- `ok`: `true` only when the run script exit code is `0`.
- `pull.success`: `true` if `git pull` completed without throwing (e.g. no remote is still a “success” for pull; run script still runs).
- `run.exitCode`: exit code of the run script, or `null` if the process could not be started.
- `error`: set if something went wrong (e.g. pull threw, or run process failed to start).

Use this response for monitoring or alerting (e.g. from GitHub Actions, Uptime Robot, or your own scripts). Non-200 status codes: **404** for wrong method/path, **401** when a secret is required and missing or wrong.
