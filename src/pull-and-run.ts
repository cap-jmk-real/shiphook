import { spawn, type ChildProcess } from "node:child_process";
import { parse as shellParse } from "shell-quote";

export type DeployOutputPhase = "pull" | "run";
export type DeployOutputStream = "stdout" | "stderr";
export type DeployOutputCallback = (
  phase: DeployOutputPhase,
  stream: DeployOutputStream,
  data: string
) => void;

/** Result of a single pull-and-run execution (git pull + script). */
export interface PullAndRunResult {
  /** True only if the run script exited with code 0. */
  success: boolean;
  /** True if `git pull` completed without throwing. */
  pullSuccess: boolean;
  pullStdout: string;
  pullStderr: string;
  runStdout: string;
  runStderr: string;
  runExitCode: number | null;
  /** Set when pull or run fails (message or stderr). */
  error?: string;
}

/**
 * Runs `git pull` in repoPath, then executes runScript in the same directory.
 * If pull fails, the script is still run (e.g. when there is no remote).
 *
 * @param repoPath - Working directory for git and the script.
 * @param runScript - Command string (e.g. "npm run deploy"). Multiline scripts and shell operators
 *   (`&&`, `||`, pipes, etc.) run via the system shell; a single simple argv line is spawned without a shell.
 * @param options - Optional settings (e.g. run timeout).
 * @returns Result with pull/run stdout, stderr, and success flags.
 */
export async function pullAndRun(
  repoPath: string,
  runScript: string,
  options?: { timeoutMs?: number; onOutput?: DeployOutputCallback }
): Promise<PullAndRunResult> {
  const result: PullAndRunResult = {
    success: false,
    pullSuccess: false,
    pullStdout: "",
    pullStderr: "",
    runStdout: "",
    runStderr: "",
    runExitCode: null,
  };

  const onOutput = options?.onOutput;

  let pullStdout = "";
  let pullStderr = "";
  const pullExitCode: number | null = await new Promise((resolve) => {
    const child = spawn("git", ["pull"], {
      cwd: repoPath,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      pullStdout += s;
      onOutput?.("pull", "stdout", s);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      pullStderr += s;
      onOutput?.("pull", "stderr", s);
    });

    child.on("close", (code) => resolve(code ?? null));
    child.on("error", (err) => {
      const msg = err.message ?? String(err);
      pullStderr += msg;
      onOutput?.("pull", "stderr", msg);
      result.error = msg;
      resolve(null);
    });
  });

  result.pullStdout = pullStdout;
  result.pullStderr = pullStderr;
  result.pullSuccess = pullExitCode === 0;
  if (!result.pullSuccess && !result.error) {
    result.error = `git pull failed with exit code ${pullExitCode ?? "null"}`;
  }
  // Still run the script so deploy can proceed (e.g. no remote configured)

  const trimmed = runScript.trim();
  const runTimeoutMs = options?.timeoutMs ?? 30 * 60 * 1000; // default: 30 minutes
  const runExitCode = shouldRunViaShell(trimmed)
    ? await runShellScript(trimmed, repoPath, result, runTimeoutMs, options?.onOutput)
    : await runParsedScript(trimmed, repoPath, result, runTimeoutMs, options?.onOutput);
  result.runExitCode = runExitCode;
  result.success = runExitCode === 0;
  return result;
}

/**
 * Parses a script string with shell-aware quoting (e.g. preserves node -e "console.log('hi')")
 * into [command, args]. Empty string yields ["npm", ["run", "deploy"]].
 */
function parseScript(script: string): [string, string[]] {
  const trimmed = script.trim();
  if (!trimmed) return ["npm", ["run", "deploy"]];
  const parts = shellParse(trimmed).filter((p): p is string => typeof p === "string");
  if (parts.length === 0) return ["npm", ["run", "deploy"]];
  return [parts[0], parts.slice(1)];
}

/** True when the script must run in a shell (multiline YAML blocks, `&&`, pipes, redirects, etc.). */
function shouldRunViaShell(trimmed: string): boolean {
  if (!trimmed) return false;
  if (trimmed.includes("\n")) return true;
  return shellParse(trimmed).some((p) => typeof p !== "string");
}

async function runParsedScript(
  trimmed: string,
  cwd: string,
  result: PullAndRunResult,
  timeoutMs: number,
  onOutput?: DeployOutputCallback
): Promise<number | null> {
  const [cmd, args] = parseScript(trimmed);
  const child = spawn(cmd, args, {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return runChildProcess(child, result, timeoutMs, onOutput);
}

async function runShellScript(
  script: string,
  cwd: string,
  result: PullAndRunResult,
  timeoutMs: number,
  onOutput?: DeployOutputCallback
): Promise<number | null> {
  const child = spawn(script, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return runChildProcess(child, result, timeoutMs, onOutput);
}

/**
 * Wires stdout/stderr, optional timeout, and exit code for a spawned child (with or without shell).
 */
function runChildProcess(
  child: ChildProcess,
  result: PullAndRunResult,
  timeoutMs: number,
  onOutput?: DeployOutputCallback
): Promise<number | null> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeoutMsg = "";
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let killEscalationId: ReturnType<typeof setTimeout> | undefined;

    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (killEscalationId !== undefined) clearTimeout(killEscalationId);
      result.runStdout = stdout;
      result.runStderr = stderr + (timedOut && timeoutMsg ? timeoutMsg : "");
      resolve(timedOut ? null : code);
    };

    timeoutId = setTimeout(() => {
      // Important: do not resolve here. On Windows, the child process may still be alive
      // for a short time after kill, which can keep temp directories "locked" and make
      // rmdir() in tests fail with EBUSY.
      timedOut = true;
      timeoutMsg = `run script timed out after ${timeoutMs}ms`;
      onOutput?.("run", "stderr", timeoutMsg);
      result.error = (result.error ?? "") + timeoutMsg;

      // Best-effort terminate. The Promise will resolve when the child actually closes.
      child.kill("SIGTERM");

      // If SIGTERM doesn't work (common in some Windows environments), escalate.
      killEscalationId = setTimeout(() => {
        if (settled) return;
        child.kill("SIGKILL");
      }, 5_000);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stdout += s;
      onOutput?.("run", "stdout", s);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderr += s;
      onOutput?.("run", "stderr", s);
    });
    child.on("close", (code) => {
      settle(code);
    });
    child.on("error", (err) => {
      const msg = err.message ?? String(err);
      stderr += msg;
      result.error = (result.error ?? "") + msg;
      onOutput?.("run", "stderr", msg);
      settle(null);
    });
  });
}
