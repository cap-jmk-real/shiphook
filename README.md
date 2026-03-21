# Shiphook

**Self-hosted deploys from Git webhooks** — receive a signed POST, run `git pull`, then run your deploy command. No third-party deploy product: your server, your repo, your script.

Shiphook is aimed at **indie projects**, **small SaaS**, and **open source** teams who want something simple they can read and own.

[![CI](https://img.shields.io/github/actions/workflow/status/cap-jmk-real/shiphook/ci.yml?style=flat-square&label=CI)](https://github.com/cap-jmk-real/shiphook/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/shiphook.svg?style=flat-square)](https://www.npmjs.com/package/shiphook)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-22%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-0ea5e9?style=flat-square&logo=readthedocs&logoColor=white)](https://cap-jmk-real.github.io/shiphook/)
[![CodeRabbit Reviews](https://img.shields.io/coderabbit/prs/github/cap-jmk-real/shiphook?style=flat-square&utm_source=oss&utm_medium=github&utm_campaign=cap-jmk-real%2Fshiphook&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)](https://coderabbit.ai)

---

## What it does

1. You run the Shiphook HTTP server in (or next to) your app repo.
2. Your Git host sends a webhook when you push.
3. Shiphook verifies a shared secret, runs **`git pull`**, reloads **`shiphook.yaml` from the repo when it lives in that tree**, and runs your **`runScript`** (build, restart containers, etc.).
4. Output can stream back in the HTTP response (useful for GitHub Actions logs) or as JSON (`?format=json`).

Configuration is **`shiphook.yaml`** in the repo and/or **environment variables** (env wins on conflicts).

---

## Install

```bash
npm install -g shiphook
```

Requires **Node 22+**.

---

## Run the server

```bash
cd /path/to/your/repo
shiphook
```

Default listen port: **3141**. Trigger a deploy:

```bash
curl -X POST http://localhost:3141/
```

Send the webhook secret as **`X-Shiphook-Secret`** or **`Authorization: Bearer …`** (see [Configuration](#configuration-yaml-or-environment)).

---

## Manual deploy (no webhook)

```bash
shiphook deploy
```

Same flow as a webhook: `git pull`, then your script.

---

## CLI

| Command | Purpose |
|--------|---------|
| `shiphook` | Start the server (or systemd integration on Linux — see docs). |
| `shiphook deploy` | Run one deploy in the foreground. |
| `shiphook version` | Print version (`-v` / `--version` also work). |
| `shiphook setup-https` | Linux helper for nginx + Let’s Encrypt (GitHub needs HTTPS). |

---

## Logs

Each deploy writes files under **`.shiphook/logs/`**:

- **`<UTC-date>_<id>.json`** — structured log for tools.
- **`<UTC-date>_<id>.log`** — human-readable.

With **`?format=json`**, the HTTP body includes `log: { id, json, log }` so you can open the matching files.

---

## HTTPS (GitHub and most hosts)

Hosts expect a **public HTTPS** URL. Shiphook speaks HTTP on localhost; put **nginx** (or similar) and **Let’s Encrypt** in front.

On **Linux**, run **`shiphook setup-https`** or say **`y`** the first time you start `shiphook` in a TTY — the installer can install packages, configure nginx, obtain certs, and install a **systemd** unit. Details: [HTTPS setup](https://cap-jmk-real.github.io/shiphook/self-hosted-https.html).

For servers without a TTY, set **`SHIPHOOK_SKIP_HTTPS_PROMPT=1`**.

---

## Configuration (YAML or environment)

Add **`shiphook.yaml`** (see [shiphook.example.yaml](shiphook.example.yaml)) or use env vars. **Env overrides the file.**

| Option | Default | Notes |
|--------|---------|--------|
| `port` / `SHIPHOOK_PORT` | `3141` | Listen port. |
| `repoPath` / `SHIPHOOK_REPO_PATH` | current directory | Where `git pull` and the script run. |
| `runScript` / `SHIPHOOK_RUN_SCRIPT` | `npm run deploy` | Command after pull. |
| `secret` / `SHIPHOOK_SECRET` | (generated) | Required. Omit in YAML and the CLI can create **`.shiphook.secret`**. |
| `path` / `SHIPHOOK_PATH` | `/` | URL path for the webhook (e.g. `/deploy`). |

After **`git pull`**, Shiphook reloads **repo-local** YAML when the config file lives **inside** the repo. Paths set with **`SHIPHOOK_CONFIG`** to **outside** the repo (e.g. `/etc/...`) are not re-read after pull—use repo-local config if you want each push to pick up YAML changes automatically.

Full reference: **[Documentation](https://cap-jmk-real.github.io/shiphook/)**

---

## GitHub webhook (quick)

1. Repo → **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL:** your HTTPS URL (path must match `SHIPHOOK_PATH`).
3. **Content type:** `application/json`.
4. **Secret:** same as your Shiphook secret.
5. **Events:** e.g. **Just the push event**.

---

## Why Shiphook?

- **No vendor lock-in** — no deploy SaaS account; you control the box and the script.
- **Small surface** — one Node process, YAML or env, secret-based auth.
- **Fits real stacks** — `npm run deploy`, Docker, shell, whatever you already use.

---

## Programmatic use

```ts
import { createShiphookServer, ensureWebhookSecret, loadConfig } from "shiphook";

const config = loadConfig();
await ensureWebhookSecret(config);
const server = createShiphookServer(config);
await server.start();
```

---

## License

MIT.
