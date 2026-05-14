import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, type ShiphookConfig } from "./config.js";
import { ensureWebhookSecret } from "./secret.js";
import { pullAndRun, type DeployOutputPhase } from "./pull-and-run.js";
import { writeDeployLogs } from "./deploy-logs.js";
import { enqueueDeploy } from "./deploy-queue.js";

/**
 * Creates an HTTP server that accepts POST on config.path, validates webhook secret,
 * and runs git pull + runScript in config.repoPath.
 *
 * By default it streams deploy output as plain text (ending with a `[done] ...` line).
 * Use `?format=json` to get the old buffered JSON response.
 *
 * @param config - Port, path, secret, repoPath, runScript (see ShiphookConfig).
 * @param options - Optional behavior toggles.
 * @returns Object with start(), stop(), and listening getter for lifecycle control.
 */
export function createShiphookServer(
  config: ShiphookConfig,
  options?: { reloadConfigEachRequest?: boolean; reloadConfigCwd?: string }
) {
  const reloadConfigEachRequest = options?.reloadConfigEachRequest ?? false;
  const reloadConfigCwd = options?.reloadConfigCwd ?? process.cwd();

  const validateRequiredSecret = (c: ShiphookConfig): string => {
    const s = c.secret.trim();
    if (!s) {
      throw new Error(
        "Shiphook webhook secret is required. Set SHIPHOOK_SECRET or shiphook.yaml:secret (or run the CLI which will generate one)."
      );
    }
    return s;
  };

  // Validate once for startup safety (even when reload is enabled, we still need a secret to start).
  const initialRequiredSecret = validateRequiredSecret(config);

  const computePathMatch = (path: string) => {
    const pathNorm = path.endsWith("/") ? path : path + "/";
    return (url: string) => {
      const u = url.split("?")[0];
      return u === path || u === pathNorm;
    };
  };

  const initialPathMatch = computePathMatch(config.path);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Optionally reload config for each request so updates in shiphook.yaml apply without restart.
    // Note: nginx/proxy config (especially the public URL path) may still need a reload if `path:` changes.
    const effectiveConfig = reloadConfigEachRequest
      ? loadConfig(process.env, { cwd: reloadConfigCwd })
      : config;

    let requiredSecret = initialRequiredSecret;
    let pathMatch = initialPathMatch;
    if (reloadConfigEachRequest) {
      try {
        // When YAML omits `secret`, we still need to load it from `.shiphook.secret`
        // (or generate + persist it once) so webhook auth keeps working.
        if (!effectiveConfig.secret.trim()) {
          // Prefer the already-known startup secret. This avoids relying on YAML to
          // include `secret` and prevents transient auth failures during reload.
          effectiveConfig.secret = initialRequiredSecret;
        }
        await ensureWebhookSecret(effectiveConfig);
        requiredSecret = validateRequiredSecret(effectiveConfig);
        pathMatch = computePathMatch(effectiveConfig.path);
      } catch (err) {
        const details = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid config", details }));
        return;
      }
    }

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

    const requestUrl = new URL(req.url ?? "", "http://localhost");
    const wantsJson = requestUrl.searchParams.get("format") === "json";

    if (wantsJson) {
      res.writeHead(200, { "Content-Type": "application/json" });
    } else {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    }

    let queuePosition = 1;
    let startedAt = new Date();

    const outputWriter = (() => {
      const partialByKey = new Map<string, string>();
      const prefixForKey = (key: string) => {
        const [phase, stream] = key.split(":");
        return `[${phase}] ${stream}: `;
      };

      const writeChunk = (phase: DeployOutputPhase, stream: "stdout" | "stderr", data: string) => {
        const key = `${phase}:${stream}`;
        const prev = partialByKey.get(key) ?? "";
        const next = prev + data;
        const parts = next.split("\n");

        const completeParts = parts.slice(0, -1);
        const lastPart = parts[parts.length - 1] ?? "";

        for (const line of completeParts) {
          res.write(`${prefixForKey(key)}${line}\n`);
        }
        partialByKey.set(key, lastPart);
      };

      const flush = () => {
        for (const [key, partial] of partialByKey.entries()) {
          if (!partial) continue;
          res.write(`${prefixForKey(key)}${partial}\n`);
          partialByKey.set(key, "");
        }
      };

      return { writeChunk, flush };
    })();

    const { result, queuePosition: finalQueuePosition } = await enqueueDeploy(
      effectiveConfig.repoPath,
      async () => {
        startedAt = new Date();
        if (!wantsJson) {
          if (queuePosition > 1) {
            res.write(`[queued] waiting; position=${queuePosition}\n`);
          }
          res.write(`[start] shiphook deploy\n`);
        }

        const onOutput = !wantsJson
          ? (phase: DeployOutputPhase, stream: "stdout" | "stderr", data: string) => {
              outputWriter.writeChunk(phase, stream, data);
            }
          : undefined;

        return pullAndRun(effectiveConfig.repoPath, effectiveConfig.runScript, {
          timeoutMs: effectiveConfig.runTimeoutMs,
          onOutput,
          rollbackOnFailure: effectiveConfig.rollbackOnFailure,
        });
      },
      {
        onQueued: (position) => {
          queuePosition = position;
        },
      }
    );

    const finishedAt = new Date();

    let logInfo:
      | {
          id: string;
          json: string;
          log: string;
        }
      | {
          error: string;
          details: string;
        }
      | undefined;
    try {
      const files = await writeDeployLogs({
        repoPath: effectiveConfig.repoPath,
        runScript: result.runScriptApplied ?? effectiveConfig.runScript,
        startedAt,
        finishedAt,
        result,
      });
      logInfo = {
        id: files.id,
        json: files.jsonPathRelativeToRepo,
        log: files.textPathRelativeToRepo,
      };
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err);
      console.error(`shiphook: failed to write deploy logs: ${details}`);
      logInfo = { error: "failed to write deploy logs", details };
      if (!wantsJson) {
        res.write(`[log] failed to write deploy logs: ${details}\n`);
      }
    }

    if (wantsJson) {
      const body = {
        ok: result.success,
        queue: { position: finalQueuePosition },
        pull: { success: result.pullSuccess, stdout: result.pullStdout, stderr: result.pullStderr },
        run: {
          stdout: result.runStdout,
          stderr: result.runStderr,
          exitCode: result.runExitCode,
        },
        rollback: result.rollback ?? null,
        error: result.error,
        log: logInfo,
      };
      res.end(JSON.stringify(body));
      return;
    }

    outputWriter.flush();

    const exitCodeString = result.runExitCode === null ? "null" : String(result.runExitCode);
    const rollbackNote = result.rollback?.attempted
      ? ` rollback=${result.rollback.success ? "ok" : "failed"}`
      : "";
    res.write(
      `[done] ok=${result.success} exitCode=${exitCodeString} queuePosition=${finalQueuePosition}${rollbackNote}\n`
    );
    res.end();
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
