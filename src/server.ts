import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, type ShiphookConfig } from "./config.js";
import { pullAndRun } from "./pull-and-run.js";
import { writeDeployLogs } from "./deploy-logs.js";

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

    // Default: stream deploy output as plain text so GitHub Actions can show it live.
    if (wantsJson) {
      res.writeHead(200, { "Content-Type": "application/json" });
    } else {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.write(`[start] shiphook deploy\n`);
    }

    const startedAt = new Date();

    const outputWriter = (() => {
      // Keep partial lines per (phase, stream) so we can prefix each emitted line.
      const partialByKey = new Map<string, string>();
      const prefixForKey = (key: string) => {
        // key format: `${phase}:${stream}`
        const [phase, stream] = key.split(":");
        return `[${phase}] ${stream}: `;
      };

      const writeChunk = (phase: "pull" | "run", stream: "stdout" | "stderr", data: string) => {
        const key = `${phase}:${stream}`;
        const prev = partialByKey.get(key) ?? "";
        const next = prev + data;
        const parts = next.split("\n");

        // If chunk ended with newline, last part is "" and should flush.
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
      ? (phase: "pull" | "run", stream: "stdout" | "stderr", data: string) => {
          outputWriter.writeChunk(phase, stream, data);
        }
      : undefined;

    const result = await pullAndRun(effectiveConfig.repoPath, effectiveConfig.runScript, {
      timeoutMs: effectiveConfig.runTimeoutMs,
      onOutput,
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
        repoPath: effectiveConfig.repoPath,
        runScript: effectiveConfig.runScript,
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
      // Logging failure should never prevent the deployment response.
      // The server will still return the pull/run output.
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
      return;
    }

    outputWriter.flush();

    const exitCodeString = result.runExitCode === null ? "null" : String(result.runExitCode);
    res.write(`[done] ok=${result.success} exitCode=${exitCodeString}\n`);
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
