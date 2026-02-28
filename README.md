# Shiphook

**Ship on hook.** One webhook, one command. Receive a POST → `git pull` → run your deploy script. No SaaS, no YAML, no containers. Just Node and your repo.

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

## Why Shiphook?

- **No vendor lock-in** — Your server, your script, your Git. No third-party deploy service.
- **One binary, zero config** — Env vars only. Run it and point your Git webhook at it.
- **Fits your stack** — Use `npm run deploy`, `pnpm build`, `./deploy.sh`, or anything else.
- **Secret-based auth** — Set `SHIPHOOK_SECRET`; send it as `X-Shiphook-Secret` or `Authorization: Bearer <secret>` so only your Git provider can trigger deploys.

## Configuration (env)

| Variable | Default | Description |
|----------|---------|-------------|
| `SHIPHOOK_PORT` | `3141` | Server port. |
| `SHIPHOOK_REPO_PATH` | current dir | Repo path for `git pull` and script. |
| `SHIPHOOK_RUN_SCRIPT` | `npm run deploy` | Command run after pull. |
| `SHIPHOOK_SECRET` | — | If set, request must send this (header or Bearer). |
| `SHIPHOOK_PATH` | `/` | Webhook path (e.g. `/deploy`). |

## GitHub webhook

1. Repo → **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL:** `https://your-server:3141/` (or your path).
3. **Secret:** (optional) Same as `SHIPHOOK_SECRET`.
4. **Events:** Push events.
5. Save. Every push triggers a deploy.

## Docs

Full docs (install, config, webhooks, programmatic API): **[Documentation](https://cap-jmk-real.github.io/shiphook/)**

## Programmatic use

```ts
import { createShiphookServer, loadConfig } from "shiphook";

const config = loadConfig();
const server = createShiphookServer(config);
await server.start();
```

## License

MIT.
