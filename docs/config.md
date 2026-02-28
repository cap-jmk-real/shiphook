# Configuration

Shiphook is configured via **environment variables**. No config file required.

| Variable | Default | Description |
|----------|---------|-------------|
| `SHIPHOOK_PORT` | `3141` | Port the server listens on. |
| `SHIPHOOK_REPO_PATH` | current directory | Path to the repo to run `git pull` and the script in. |
| `SHIPHOOK_RUN_SCRIPT` | `npm run deploy` | Command to run after pull (e.g. `pnpm deploy`, `./deploy.sh`). |
| `SHIPHOOK_SECRET` | (none) | If set, requests must include this as `X-Shiphook-Secret` or `Authorization: Bearer <secret>`. |
| `SHIPHOOK_PATH` | `/` | HTTP path for the webhook (e.g. `/deploy`). |

## Examples

Custom port and script:

```bash
export SHIPHOOK_PORT=8080
export SHIPHOOK_RUN_SCRIPT="pnpm run build && pm2 restart all"
shiphook
```

Different repo and path:

```bash
export SHIPHOOK_REPO_PATH=/var/www/my-app
export SHIPHOOK_PATH=/webhook
shiphook
```

Then trigger with `POST http://your-server:8080/webhook`.

## Programmatic use

You can run the server from your own Node script:

```ts
import { createShiphookServer, loadConfig } from "shiphook";

const config = loadConfig();
const server = createShiphookServer(config);
await server.start();
```

Or override config:

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
