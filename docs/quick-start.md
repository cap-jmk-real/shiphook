# Quick start

## Install

```bash
npm install -g shiphook
```

Or with pnpm or yarn:

```bash
pnpm add -g shiphook
yarn global add shiphook
```

## Run

From your project directory:

```bash
shiphook
```

You’ll see:

```
Shiphook listening on http://localhost:3141
  Repo: /path/to/your/repo
  Run:  npm run deploy
```

Trigger a deploy:

```bash
curl -X POST http://localhost:3141/
```

The response includes pull and run output and exit status.

## Add a deploy script

In your `package.json`:

```json
{
  "scripts": {
    "deploy": "npm run build && pm2 restart my-app"
  }
}
```

Or use any command via `SHIPHOOK_RUN_SCRIPT` (see [Configuration](./config)).

## Secure with a secret

Set a secret so only your Git provider can trigger deploys:

```bash
export SHIPHOOK_SECRET=your-random-secret
shiphook
```

Send it in the request:

- Header: `X-Shiphook-Secret: your-random-secret`
- Or: `Authorization: Bearer your-random-secret`

In GitHub, add the same value as the webhook “Secret” so GitHub signs the payload and you can verify it.

## Next steps

- [Configuration](./config) — port, path, repo, script
- [Webhook setup](./webhooks) — GitHub, GitLab, etc.
