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

type RunChildOutcome = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

/**
 * Runs `git pull` in repoPath, then executes runScript in the same directory.
 * If pull fails, the script is still run (e.g. when there is no remote).
 *
 * @param repoPath - Working directory for git and the script.
 * @param runScript - Command string (e.g. "npm run deploy"). Multiline scripts run **one line at a time**
 *   in order (fail-fast). Shell operators (`&&`, `|`, …) or shell builtins (`set`, `export`, …) use the
 *   system shell for that line; a simple single-line argv command is spawned without a shell.
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
  const deadline = Date.now() + runTimeoutMs;

  const lines = splitRunScriptLines(trimmed);
  let runExitCode: number | null;

  if (lines.length === 0) {
    const r = await runOneLine("npm run deploy", repoPath, Math.max(0, deadline - Date.now()), result, onOutput);
    result.runStdout = r.stdout;
    result.runStderr = r.stderr;
    runExitCode = r.exitCode;
  } else if (lines.length === 1) {
    const r = await runOneLine(lines[0]!, repoPath, Math.max(0, deadline - Date.now()), result, onOutput);
    result.runStdout = r.stdout;
    result.runStderr = r.stderr;
    runExitCode = r.exitCode;
  } else {
    let allOut = "";
    let allErr = "";
    runExitCode = 0;
    for (const line of lines) {
      const remaining = Math.max(0, deadline - Date.now());
      if (remaining === 0) {
        const timeoutMsg = `run script timed out after ${runTimeoutMs}ms`;
        result.error = (result.error ?? "") + timeoutMsg;
        onOutput?.("run", "stderr", timeoutMsg);
        allErr += timeoutMsg;
        result.runStdout = allOut;
        result.runStderr = allErr;
        runExitCode = null;
        break;
      }
      const r = await runOneLine(line, repoPath, remaining, result, onOutput);
      allOut += r.stdout;
      allErr += r.stderr;
      if (r.exitCode !== 0 || r.exitCode === null) {
        result.runStdout = allOut;
        result.runStderr = allErr;
        runExitCode = r.exitCode;
        break;
      }
    }
    if (runExitCode === 0) {
      result.runStdout = allOut;
      result.runStderr = allErr;
    }
  }

  result.runExitCode = runExitCode;
  result.success = runExitCode === 0;
  return result;
}

/**
 * Non-empty, non-comment lines in order (YAML `|` blocks, etc.).
 */
function splitRunScriptLines(trimmed: string): string[] {
  return trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/**
 * Parses a script string with shell-aware quoting (e.g. preserves node -e "console.log('hi')")
 * into [command, args]. Empty string yields ["npm", ["run", "deploy"]].
 */
function parseScript(script: string): [string, string[]] {
  const t = script.trim();
  if (!t) return ["npm", ["run", "deploy"]];
  const parts = shellParse(t).filter((p): p is string => typeof p === "string");
  if (parts.length === 0) return ["npm", ["run", "deploy"]];
  return [parts[0], parts.slice(1)];
}

/** True when the line must run in a shell (operators, pipes, or common shell builtins). */
function lineNeedsShell(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (shellParse(t).some((p) => typeof p !== "string")) return true;
  const first = t.split(/\s+/)[0] ?? "";
  if (/^(set|export|unset|alias|cd)$/.test(first)) return true;
  return false;
}

async function runOneLine(
  line: string,
  cwd: string,
  timeoutMs: number,
  result: PullAndRunResult,
  onOutput?: DeployOutputCallback
): Promise<RunChildOutcome> {
  const t = line.trim();
  if (!t) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  if (lineNeedsShell(t)) {
    return runShellScriptLine(t, cwd, timeoutMs, result, onOutput);
  }
  const [cmd, args] = parseScript(t);
  const child = spawn(cmd, args, {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return runChildProcess(child, timeoutMs, result, onOutput);
}

async function runShellScriptLine(
  script: string,
  cwd: string,
  timeoutMs: number,
  result: PullAndRunResult,
  onOutput?: DeployOutputCallback
): Promise<RunChildOutcome> {
  const child = spawn(script, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return runChildProcess(child, timeoutMs, result, onOutput);
}

/**
 * Wires stdout/stderr, optional timeout, and exit code for a spawned child (with or without shell).
 */
function runChildProcess(
  child: ChildProcess,
  timeoutMs: number,
  result: PullAndRunResult,
  onOutput?: DeployOutputCallback
): Promise<RunChildOutcome> {
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
      const stderrOut = stderr + (timedOut && timeoutMsg ? timeoutMsg : "");
      resolve({ stdout, stderr: stderrOut, exitCode: timedOut ? null : code });
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
