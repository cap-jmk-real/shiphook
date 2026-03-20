# Shiphook

**Ship on hook.** One webhook. One command. Your server, your deploy — no SaaS, no lock-in.

Shiphook is a small HTTP server that receives a POST (webhook), runs `git pull` in your repo, then runs your deploy script. Built for **indie devs**, **micro-SaaS**, and **open-source** projects that want simple, self-hosted deploys.

---

## What Shiphook does

- **Listens** for HTTP POST requests on a port you choose (default: 3141).
- **Pulls** the latest code with `git pull` in the repo you specify.
- **Runs** a single command after pull (e.g. `npm run deploy`, `pnpm build`, `./deploy.sh`).
- **Returns** streaming plain text output by default (ends with a `[done] ...` line). Use `?format=json` to get the old buffered JSON response.

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

Auth is required: configure `SHIPHOOK_SECRET` (or `shiphook.yaml:secret`) and send it in the request (header `X-Shiphook-Secret` or `Authorization: Bearer <secret>`). If you omit it, the CLI auto-generates a secret and persists it to `.shiphook.secret`.

---

## Documentation overview

| Page | Contents |
|------|----------|
| [Quick start](./quick-start) | Install, run, deploy once, secret-based auth. |
| [Configuration](./config) | YAML file (shiphook.yaml), env vars, and programmatic API. |
| [Webhook setup](./webhooks) | GitHub, GitLab, generic POST; response format. |

---

## Links

- [GitHub repository](https://github.com/cap-jmk-real/shiphook)
- [npm package](https://www.npmjs.com/package/shiphook)
