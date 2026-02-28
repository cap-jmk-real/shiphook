# Configuration

Shiphook is configured via a **YAML file** and/or **environment variables**. The file defines the deployment Shiphook runs; env vars override the file. All options are optional; defaults are listed below.

---

## Config file: `shiphook.yaml`

In your repo (or the directory you run `shiphook` from), add **`shiphook.yaml`** (or `.shiphook.yaml`, `shiphook.yml`, `.shiphook.yml`). Use it to define port, repo path, run script, path, and optional secret.

**Example:**

```yaml
port: 3141
repoPath: .                    # or absolute path, e.g. /var/www/my-app
runScript: npm run deploy
path: /
# secret: your-webhook-secret  # optional; prefer env for secrets
```

You can use **camelCase** (`repoPath`, `runScript`) or **snake_case** (`repo_path`, `run_script`).

**Config file lookup:** Shiphook looks in the current working directory for the first file that exists: **shiphook.yaml**, **shiphook.yml**, **.shiphook.yaml**, **.shiphook.yml**. To use a different path, set **`SHIPHOOK_CONFIG`** (e.g. `./custom.yaml`). If no file is found or the file is invalid, only env vars and defaults apply.

---

## Environment variables (override file)

Env vars take precedence over the YAML file. Use them for secrets or overrides without editing the file.

| Variable | Default | Purpose |
|----------|---------|---------|
| `SHIPHOOK_PORT` | `3141` | TCP port the server listens on. |
| `SHIPHOOK_REPO_PATH` | (from file or cwd) | Directory where `git pull` and the run script execute. |
| `SHIPHOOK_RUN_SCRIPT` | (from file or `npm run deploy`) | Command run after `git pull`. |
| `SHIPHOOK_SECRET` | (none) | If set, every POST must send this via `X-Shiphook-Secret` or `Authorization: Bearer <secret>`. |
| `SHIPHOOK_PATH` | `/` | URL path that accepts the webhook (e.g. `/deploy`). |
| `SHIPHOOK_CONFIG` | (auto-detect) | Path to config file (e.g. `./shiphook.yaml`). |

---

## Port and run script

In YAML:

```yaml
port: 8080
runScript: pnpm run build && pm2 restart all
```

Or with env:

```bash
export SHIPHOOK_PORT=8080
export SHIPHOOK_RUN_SCRIPT="pnpm run build && pm2 restart all"
shiphook
```

Deploy is then triggered with `POST http://your-server:8080/`.

---

## Repo path and webhook path

In YAML:

```yaml
repoPath: /var/www/my-app
path: /webhook
```

Or with env:

```bash
export SHIPHOOK_REPO_PATH=/var/www/my-app
export SHIPHOOK_PATH=/webhook
shiphook
```

Trigger with `POST http://your-server:3141/webhook`. Shiphook runs `git pull` and the run script in `/var/www/my-app`.

---

## Programmatic use

You can start the Shiphook server from your own Node.js (ES module) code.

**Use file + env config (same as CLI):**

```ts
import { createShiphookServer, loadConfig } from "shiphook";

const config = loadConfig();
const server = createShiphookServer(config);
await server.start();
```

**Override config explicitly:**

```ts
import { createShiphookServer } from "shiphook";

const server = createShiphookServer({
  port: 3141,
  repoPath: "/app",
  runScript: "npm run deploy",
  secret: process.env.WEBHOOK_SECRET,
  path: "/",
});
await server.start();
```

The server object has `start()`, `stop()`, and a `listening` getter. Config shape matches the YAML keys (camelCase: `repoPath`, `runScript`, etc.).
