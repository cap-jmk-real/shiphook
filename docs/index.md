# Shiphook

**Ship on hook.** Receive a webhook, pull latest, run your deploy script. No SaaS, no vendor lock-in — one process on your server.

Built for **indie devs**, **micro-SaaS**, and **open-source** projects that want simple, self-hosted deploys.

## How it works

1. You run `shiphook` in your project directory (or point it at a repo).
2. GitHub (or any service) sends a POST to your Shiphook URL when you push.
3. Shiphook runs `git pull`, then your script (e.g. `npm run deploy`).
4. You get a JSON response with pull and run output.

No containers required. No YAML pipelines. Just a webhook and a script.

## Quick start

```bash
npm install -g shiphook
cd /path/to/your/repo
shiphook
```

By default Shiphook listens on port **3141**. Send a POST to `http://your-server:3141/` to trigger a deploy.

Optional: set `SHIPHOOK_SECRET` and send it as `X-Shiphook-Secret` or `Authorization: Bearer <secret>` so only your Git provider can trigger deploys.

## Links

- [Quick start & installation](./quick-start)
- [Configuration reference](./config)
- [Webhook setup (GitHub, etc.)](./webhooks)
- [GitHub repo](https://github.com/cap-jmk-real/shiphook) · [npm](https://www.npmjs.com/package/shiphook)
