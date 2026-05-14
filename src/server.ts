import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { resolve as resolvePath } from "node:path";
import { loadConfig, type ShiphookAppConfig, type ShiphookConfig } from "./config.js";
import { ensureWebhookSecret, ensureWebhookSecrets } from "./secret.js";
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

  const getApps = (c: ShiphookConfig): ShiphookAppConfig[] => {
    if (Array.isArray(c.apps) && c.apps.length > 0) return c.apps;
    return [
      {
        name: "default",
        host: "",
        path: c.path,
        repoPath: c.repoPath,
        runScript: c.runScript,
        secret: c.secret,
        runTimeoutMs: c.runTimeoutMs,
      },
    ];
  };

  const isMultiAppConfig = (c: ShiphookConfig): boolean => {
    const apps = getApps(c);
    return apps.length > 1 || (apps.length === 1 && apps[0]?.host.trim() !== "");
  };

  const computePathMatch = (path: string) => {
    const pathNorm = path.endsWith("/") ? path : path + "/";
    return (url: string) => {
      const u = url.split("?")[0];
      return u === path || u === pathNorm;
    };
  };

  const normalizeHostForRouting = (hostHeader: string): string => {
    // Match config.ts normalization (trim, lowercase, strip trailing dot, then remove :port suffix).
    return hostHeader.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  };

  // Serialize per working tree/repo so pull + run never overlap for the same checkout.
  const deployLockKey = (app: ShiphookAppConfig): string =>
    `${resolvePath(app.repoPath)}|${app.host}|${app.path}`;

  const resolveAppForRequest = (c: ShiphookConfig, req: IncomingMessage): ShiphookAppConfig | null => {
    const urlRaw = req.url ?? "";
    const apps = getApps(c);
    if (!apps.length) return null;

    if (!isMultiAppConfig(c)) {
      const app = apps[0]!;
      return computePathMatch(app.path)(urlRaw) ? app : null;
    }

    const hostHeader = req.headers.host;
    const host = typeof hostHeader === "string" ? normalizeHostForRouting(hostHeader) : "";
    if (!host) return null;

    for (const app of apps) {
      if (app.host !== host) continue;
      if (computePathMatch(app.path)(urlRaw)) return app;
    }
    return null;
  };

  // Validate once for startup safety.
  const initialIsMulti = isMultiAppConfig(config);
  const initialRequiredSecret = initialIsMulti ? "" : validateRequiredSecret(config);
  if (initialIsMulti) {
    for (const app of getApps(config)) {
      if (!app.secret.trim()) {
        throw new Error(
          `Invalid multi-app config: app "${app.name}" (${app.host}${app.path}) is missing secret`
        );
      }
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Optionally reload config for each request so updates in shiphook.yaml apply without restart.
    // Note: nginx/proxy config (especially the public URL path) may still need a reload if `path:` changes.
    const effectiveConfig = reloadConfigEachRequest
      ? loadConfig(process.env, { cwd: reloadConfigCwd })
      : config;

    let effectiveRequiredSecret = initialRequiredSecret;
    if (reloadConfigEachRequest) {
      try {
        if (!isMultiAppConfig(effectiveConfig)) {
          // When single-app YAML omits `secret`, still ensure/persist it.
          if (!effectiveConfig.secret.trim()) {
            effectiveConfig.secret = initialRequiredSecret;
          }
          await ensureWebhookSecret(effectiveConfig);
          effectiveRequiredSecret = validateRequiredSecret(effectiveConfig);
        } else {
          await ensureWebhookSecrets(effectiveConfig);
        }
      } catch (err) {
        const details = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid config", details }));
        return;
      }
    }

    if (req.method !== "POST") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
      return;
    }

    const matchedApp = resolveAppForRequest(effectiveConfig, req);
    if (!matchedApp) {
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
    const requiredSecret = isMultiAppConfig(effectiveConfig)
      ? matchedApp.secret
      : (effectiveRequiredSecret || matchedApp.secret);
    if (token !== requiredSecret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }

    const requestUrl = new URL(req.url ?? "", "http://localhost");
    const wantsJson = requestUrl.searchParams.get("format") === "json";
    let queuePosition = 1;
    let responseStarted = false;

    const startResponseIfNeeded = (position: number) => {
      if (responseStarted) return;
      responseStarted = true;
      if (wantsJson) {
        res.writeHead(200, { "Content-Type": "application/json" });
      } else {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        if (position > 1) {
          res.write(`[queued] waiting; position=${position}\n`);
        }
      }
    };

    const { result: _deployResult } = await enqueueDeploy(
      deployLockKey(matchedApp),
      async () => {
        startResponseIfNeeded(queuePosition);
        if (!wantsJson) {
          res.write(`[start] shiphook deploy\n`);
        }

        const startedAt = new Date();

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

        const onOutput = !wantsJson
          ? (phase: DeployOutputPhase, stream: "stdout" | "stderr", data: string) => {
              outputWriter.writeChunk(phase, stream, data);
            }
          : undefined;

        const deployResult = await pullAndRun(matchedApp.repoPath, matchedApp.runScript, {
          timeoutMs: matchedApp.runTimeoutMs,
          onOutput,
          rollbackOnFailure: effectiveConfig.rollbackOnFailure,
        });
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
            repoPath: matchedApp.repoPath,
            runScript: deployResult.runScriptApplied ?? matchedApp.runScript,
            startedAt,
            finishedAt,
            result: deployResult,
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
            ok: deployResult.success,
            queue: { position: queuePosition },
            pull: {
              success: deployResult.pullSuccess,
              stdout: deployResult.pullStdout,
              stderr: deployResult.pullStderr,
            },
            run: {
              stdout: deployResult.runStdout,
              stderr: deployResult.runStderr,
              exitCode: deployResult.runExitCode,
            },
            rollback: deployResult.rollback ?? null,
            error: deployResult.error,
            log: logInfo,
          };
          res.end(JSON.stringify(body));
          return deployResult;
        }

        outputWriter.flush();

        const exitCodeString =
          deployResult.runExitCode === null ? "null" : String(deployResult.runExitCode);
        const rollbackNote = deployResult.rollback?.attempted
          ? ` rollback=${deployResult.rollback.success ? "ok" : "failed"}`
          : "";
        res.write(
          `[done] ok=${deployResult.success} exitCode=${exitCodeString} queuePosition=${queuePosition}${rollbackNote}\n`
        );
        res.end();
        return deployResult;
      },
      {
        onQueued: (position) => {
          queuePosition = position;
          startResponseIfNeeded(position);
        },
      }
    );
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
