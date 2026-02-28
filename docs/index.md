# Shiphook

**Ship on hook.** One webhook. One command. Your server, your deploy — no SaaS, no lock-in.

Shiphook is a small HTTP server that receives a POST (webhook), runs `git pull` in your repo, then runs your deploy script. Built for **indie devs**, **micro-SaaS**, and **open-source** projects that want simple, self-hosted deploys.

---

## What Shiphook does

- **Listens** for HTTP POST requests on a port you choose (default: 3141).
- **Pulls** the latest code with `git pull` in the repo you specify.
- **Runs** a single command after pull (e.g. `npm run deploy`, `pnpm build`, `./deploy.sh`).
- **Returns** JSON with pull output, run output, and exit status.

No containers. No third-party deploy service. Configure the deployment in **shiphook.yaml** (or with env vars). One process, one script.

---

## Quick start

Install the CLI and run it in your project directory:

```bash
npm install -g shiphook
cd /path/to/your/repo
shiphook
```

Shiphook listens on **port 3141** by default. To trigger a deploy, send a POST to:

`http://your-server:3141/`

Optional: set `SHIPHOOK_SECRET` and send it in the request (header `X-Shiphook-Secret` or `Authorization: Bearer <secret>`) so only your Git provider can trigger deploys.

---

## Documentation overview

| Page | Contents |
|------|----------|
| [Quick start](./quick-start) | Install, run, first deploy, optional secret. |
| [Configuration](./config) | YAML file (shiphook.yaml), env vars, and programmatic API. |
| [Webhook setup](./webhooks) | GitHub, GitLab, generic POST; response format. |

---

## Links

- [GitHub repository](https://github.com/cap-jmk-real/shiphook)
- [npm package](https://www.npmjs.com/package/shiphook)
