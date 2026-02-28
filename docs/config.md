# Configuration

Shiphook is configured **only via environment variables**. There is no config file. All options are optional; defaults are listed below.

---

## Summary: environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SHIPHOOK_PORT` | `3141` | TCP port the server listens on. |
| `SHIPHOOK_REPO_PATH` | current working directory | Directory where `git pull` and the run script execute. |
| `SHIPHOOK_RUN_SCRIPT` | `npm run deploy` | Command run after `git pull` (e.g. `pnpm deploy`, `./deploy.sh`). |
| `SHIPHOOK_SECRET` | (none) | If set, every POST must send this value via `X-Shiphook-Secret` or `Authorization: Bearer <secret>`. |
| `SHIPHOOK_PATH` | `/` | URL path that accepts the webhook (e.g. `/deploy`). |

---

## Port and run script

Change the port and the command that runs after pull:

```bash
export SHIPHOOK_PORT=8080
export SHIPHOOK_RUN_SCRIPT="pnpm run build && pm2 restart all"
shiphook
```

Deploy is then triggered with `POST http://your-server:8080/`.

---

## Repo path and webhook path

Run Shiphook from one directory but deploy a different repo, or expose the webhook on a custom path:

```bash
export SHIPHOOK_REPO_PATH=/var/www/my-app
export SHIPHOOK_PATH=/webhook
shiphook
```

Trigger with `POST http://your-server:3141/webhook`. Shiphook will run `git pull` and the run script in `/var/www/my-app`.

---

## Programmatic use

You can start the Shiphook server from your own Node.js (ES module) code.

**Use environment-based config (same as CLI):**

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

The server object has `start()`, `stop()`, and a `listening` getter. Config shape matches the environment variables above (camelCase: `repoPath`, `runScript`, etc.).
