# Shiphook

**Ship on hook.** One webhook, one command. Receive a POST → `git pull` → run your deploy script. Configure the deployment via **YAML** or env vars. No SaaS, no containers. Just Node and your repo.

Built for **indie devs**, **micro-SaaS**, and **open-source** projects that want simple, self-hosted deploys.

[![CI](https://img.shields.io/github/actions/workflow/status/cap-jmk-real/shiphook/ci.yml?style=flat-square&label=CI)](https://github.com/cap-jmk-real/shiphook/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/shiphook.svg?style=flat-square)](https://www.npmjs.com/package/shiphook)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-0ea5e9?style=flat-square&logo=readthedocs&logoColor=white)](https://cap-jmk-real.github.io/shiphook/)
[![CodeRabbit Reviews](https://img.shields.io/coderabbit/prs/github/cap-jmk-real/shiphook?style=flat-square&utm_source=oss&utm_medium=github&utm_campaign=cap-jmk-real%2Fshiphook&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)](https://coderabbit.ai)

---

## Install

```bash
npm install -g shiphook
```

## Run

```bash
cd /path/to/your/repo
shiphook
```

By default Shiphook listens on **port 3141**. Send a POST to trigger a deploy:

```bash
curl -X POST http://localhost:3141/
```

It runs `git pull` in the repo, then your script (default: `npm run deploy`). Response is JSON with pull and run output.

## Deploy once (manual)

From your repo root, run:

```bash
shiphook deploy
```

## Logs (deploy history)

For every webhook-triggered deploy (and `shiphook deploy`), Shiphook writes a log file into:

- `.shiphook/logs/<id>.json` (machine-readable)
- `.shiphook/logs/<id>.log` (human-readable)

The server response includes `log: { id, json, log }` so you can correlate a request to a file.

## Why Shiphook?

- **No vendor lock-in** — Your server, your script, your Git. No third-party deploy service.
- **YAML or env** — Put `shiphook.yaml` in your repo (or set env vars). Env overrides file. Run and point your Git webhook at it.
- **Fits your stack** — Use `npm run deploy`, `pnpm build`, `./deploy.sh`, or anything else.
- **Secret-based auth (required)** — The server always requires a secret. Set `SHIPHOOK_SECRET` (or `secret:` in `shiphook.yaml`), or omit it and the CLI will auto-generate one and persist it to `.shiphook.secret`. Send it as `X-Shiphook-Secret` or `Authorization: Bearer <secret>`.

## Configuration (YAML or env)

Add a **`shiphook.yaml`** in your repo (see [shiphook.example.yaml](shiphook.example.yaml)) or set env vars. Env overrides the file.

| Option | Default | Description |
|--------|---------|-------------|
| `port` / `SHIPHOOK_PORT` | `3141` | Server port. |
| `repoPath` / `SHIPHOOK_REPO_PATH` | current dir | Repo path for `git pull` and script. |
| `runScript` / `SHIPHOOK_RUN_SCRIPT` | `npm run deploy` | Command run after pull. |
| `secret` / `SHIPHOOK_SECRET` | — | Required for auth. If omitted, the CLI auto-generates and persists one in `.shiphook.secret`. |
| `path` / `SHIPHOOK_PATH` | `/` | Webhook path (e.g. `/deploy`). |

## GitHub webhook

1. Repo → **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL:** `https://your-server:3141/` (or your path).
3. **Secret:** Same as `SHIPHOOK_SECRET` / `.shiphook.secret`.
4. **Events:** Push events.
5. Save. Every push triggers a deploy.

## Docs

Full docs (install, config, webhooks, programmatic API): **[Documentation](https://cap-jmk-real.github.io/shiphook/)**

## Programmatic use

```ts
import { createShiphookServer, ensureWebhookSecret, loadConfig } from "shiphook";

const config = loadConfig();
await ensureWebhookSecret(config);
const server = createShiphookServer(config);
await server.start();
```

## License

MIT.
