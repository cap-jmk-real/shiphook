# Quick start

Get Shiphook running in a few steps: install the CLI, run it in your repo, then send a POST to trigger a deploy.

---

## Install Shiphook

Install the global CLI:

```bash
npm install -g shiphook
```

With pnpm or yarn:

```bash
pnpm add -g shiphook
yarn global add shiphook
```

---

## Run the server

From your project (or any repo) directory:

```bash
shiphook
```

You should see:

```
Shiphook listening on http://localhost:3141
  Repo: /path/to/your/repo
  Run:  npm run deploy
```

Shiphook is now waiting for a POST on port **3141**. Each POST triggers one deploy: `git pull` then your run script.

---

## Trigger a deploy

Send an HTTP POST to the Shiphook URL:

```bash
curl -X POST http://localhost:3141/
```

The response is JSON: pull stdout/stderr, run script stdout/stderr, and run exit code. If the run script exits 0, `ok` is `true`.

---

## Define your deploy (run script)

By default Shiphook runs `npm run deploy` after pull. Add that script to your `package.json`:

```json
{
  "scripts": {
    "deploy": "npm run build && pm2 restart my-app"
  }
}
```

You can use any command: `pnpm deploy`, `./deploy.sh`, `docker compose up -d --build`. Set it in **shiphook.yaml** (`runScript: ...`) or with the **`SHIPHOOK_RUN_SCRIPT`** env var (see [Configuration](./config)).

---

## Optional: secure the webhook with a secret

To ensure only your Git host (e.g. GitHub) can trigger deploys, set a shared secret.

**1. Set the secret when running Shiphook:**

```bash
export SHIPHOOK_SECRET=your-random-secret
shiphook
```

**2. Send the secret with each request:**

- Header: `X-Shiphook-Secret: your-random-secret`
- Or: `Authorization: Bearer your-random-secret`

**3. In GitHub (or your Git host):** use the same value as the webhook “Secret” so only they know it.

Without the correct secret, Shiphook responds with **401 Unauthorized**.

---

## Next steps

- [Configuration](./config) — **shiphook.yaml**, env vars, and programmatic API.
- [Webhook setup](./webhooks) — configure GitHub, GitLab, or any service that can send a POST.
