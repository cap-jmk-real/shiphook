import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { ShiphookConfig } from "./config.js";
import { pullAndRun } from "./pull-and-run.js";
import { writeDeployLogs } from "./deploy-logs.js";

/**
 * Creates an HTTP server that accepts POST on config.path, validates webhook secret,
 * and runs git pull + runScript in config.repoPath, returning JSON with pull/run result.
 *
 * @param config - Port, path, secret, repoPath, runScript (see ShiphookConfig).
 * @returns Object with start(), stop(), and listening getter for lifecycle control.
 */
export function createShiphookServer(config: ShiphookConfig) {
  if (typeof config.secret !== "string" || config.secret.length === 0) {
    throw new Error(
      "Shiphook webhook secret is required. Set SHIPHOOK_SECRET or shiphook.yaml:secret (or run the CLI which will generate one)."
    );
  }
  const requiredSecret = config.secret;

  const pathNorm = config.path.endsWith("/") ? config.path : config.path + "/";
  const pathMatch = (url: string) => {
    const u = url.split("?")[0];
    return u === config.path || u === pathNorm;
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || !pathMatch(req.url ?? "")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
      return;
    }

    // Auth is always required for matching POSTs.
    const authHeader = req.headers["authorization"];
    const shiphookSecret = req.headers["x-shiphook-secret"];
    const token =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : shiphookSecret;
    if (token !== requiredSecret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });

    const startedAt = new Date();
    const result = await pullAndRun(config.repoPath, config.runScript);
    const finishedAt = new Date();

    let logInfo:
      | {
          id: string;
          json: string;
          log: string;
        }
      | undefined;
    try {
      const files = await writeDeployLogs({
        repoPath: config.repoPath,
        runScript: config.runScript,
        startedAt,
        finishedAt,
        result,
      });
      logInfo = {
        id: files.id,
        json: files.jsonPathRelativeToRepo,
        log: files.textPathRelativeToRepo,
      };
    } catch {
      // Logging failure should never prevent the deployment response.
      // The server will still return the pull/run output.
    }

    const body = {
      ok: result.success,
      pull: { success: result.pullSuccess, stdout: result.pullStdout, stderr: result.pullStderr },
      run: {
        stdout: result.runStdout,
        stderr: result.runStderr,
        exitCode: result.runExitCode,
      },
      error: result.error,
      log: logInfo,
    };
    res.end(JSON.stringify(body));
  });

  return {
    start() {
      return new Promise<void>((resolve) => {
        server.listen(config.port, () => resolve());
      });
    },
    stop() {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
    get listening() {
      return server.listening;
    },
  };
}
