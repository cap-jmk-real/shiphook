import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { parse as shellParse } from "shell-quote";
import { hasShiphookConfigFile, loadConfig } from "./config.js";

export type DeployOutputPhase = "pull" | "run" | "rollback";
export type DeployOutputStream = "stdout" | "stderr";
export type DeployOutputCallback = (
  phase: DeployOutputPhase,
  stream: DeployOutputStream,
  data: string
) => void;

export type RollbackResult = {
  attempted: boolean;
  success: boolean;
  prePullSha: string | null;
  resetSuccess: boolean;
  runExitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

/** Result of a single pull-and-run execution (git pull + script). */
export interface PullAndRunResult {
  /** True only if the run script exited with code 0 (after rollback redeploy when attempted). */
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
  /** `runScript` and timeout actually used for the run phase (after `git pull` reload when YAML exists). */
  runScriptApplied?: string;
  runTimeoutMsApplied?: number;
  rollback?: RollbackResult;
}

type RunChildOutcome = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type GitCommandOutcome = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

async function runGitCommand(
  repoPath: string,
  args: string[],
  onOutput?: DeployOutputCallback,
  phase: DeployOutputPhase = "pull"
): Promise<GitCommandOutcome> {
  let stdout = "";
  let stderr = "";
  const exitCode: number | null = await new Promise((resolveExit) => {
    const child = spawn("git", args, {
      cwd: repoPath,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stdout += s;
      onOutput?.(phase, "stdout", s);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderr += s;
      onOutput?.(phase, "stderr", s);
    });

    child.on("close", (code) => resolveExit(code ?? null));
    child.on("error", (err) => {
      const msg = err.message ?? String(err);
      stderr += msg;
      onOutput?.(phase, "stderr", msg);
      resolveExit(null);
    });
  });

  return { success: exitCode === 0, stdout, stderr, exitCode };
}

async function getHeadSha(repoPath: string): Promise<string | null> {
  const r = await runGitCommand(repoPath, ["rev-parse", "HEAD"]);
  if (!r.success) return null;
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}

async function gitResetHard(
  repoPath: string,
  sha: string,
  onOutput?: DeployOutputCallback
): Promise<GitCommandOutcome> {
  return runGitCommand(repoPath, ["reset", "--hard", sha], onOutput, "rollback");
}

/**
 * Runs `git pull` in repoPath, then executes runScript in the same directory.
 * If pull fails, the script is still run (e.g. when there is no remote).
 *
 * @param repoPath - Working directory for git and the script.
 * @param runScript - Command string (e.g. "npm run deploy"). Multiline scripts run **one line at a time**
 *   in order (fail-fast). Shell operators (`&&`, `|`, …) or shell builtins (`set`, `export`, …) use the
 *   system shell for that line; a simple single-line argv command is spawned without a shell.
 * @param options - Optional settings (e.g. run timeout, rollback on failure).
 * @returns Result with pull/run stdout, stderr, and success flags.
 */
export async function pullAndRun(
  repoPath: string,
  runScript: string,
  options?: { timeoutMs?: number; onOutput?: DeployOutputCallback; rollbackOnFailure?: boolean }
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
  const rollbackOnFailure = options?.rollbackOnFailure ?? false;
  const prePullSha = await getHeadSha(repoPath);

  let pullStdout = "";
  let pullStderr = "";
  const pullExitCode: number | null = await new Promise((resolveExit) => {
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

    child.on("close", (code) => resolveExit(code ?? null));
    child.on("error", (err) => {
      const msg = err.message ?? String(err);
      pullStderr += msg;
      onOutput?.("pull", "stderr", msg);
      result.error = msg;
      resolveExit(null);
    });
  });

  result.pullStdout = pullStdout;
  result.pullStderr = pullStderr;
  result.pullSuccess = pullExitCode === 0;
  if (!result.pullSuccess && !result.error) {
    result.error = `git pull failed with exit code ${pullExitCode ?? "null"}`;
  }

  const absRepo = resolve(repoPath);
  const runPhase = await runDeployPhase(absRepo, runScript, options?.timeoutMs ?? 30 * 60 * 1000, result, onOutput, "run");

  result.runStdout = runPhase.stdout;
  result.runStderr = runPhase.stderr;
  result.runExitCode = runPhase.exitCode;
  result.runScriptApplied = runPhase.runScriptApplied;
  result.runTimeoutMsApplied = runPhase.runTimeoutMsApplied;
  result.success = runPhase.exitCode === 0;

  if (!result.success && rollbackOnFailure && prePullSha) {
    const postPullSha = await getHeadSha(repoPath);
    if (postPullSha && postPullSha !== prePullSha) {
      const rollback: RollbackResult = {
        attempted: true,
        success: false,
        prePullSha,
        resetSuccess: false,
        runExitCode: null,
        stdout: "",
        stderr: "",
      };

      const reset = await gitResetHard(repoPath, prePullSha, onOutput);
      rollback.resetSuccess = reset.success;
      rollback.stdout += reset.stdout;
      rollback.stderr += reset.stderr;
      if (!reset.success) {
        rollback.error = `git reset --hard failed with exit code ${reset.exitCode ?? "null"}`;
        result.rollback = rollback;
        return result;
      }

      const rollbackRun = await runDeployPhase(
        absRepo,
        runScript,
        options?.timeoutMs ?? 30 * 60 * 1000,
        result,
        onOutput,
        "rollback"
      );
      rollback.stdout += rollbackRun.stdout;
      rollback.stderr += rollbackRun.stderr;
      rollback.runExitCode = rollbackRun.exitCode;
      rollback.success = rollbackRun.exitCode === 0;
      if (!rollback.success && !rollback.error) {
        rollback.error = `rollback redeploy failed with exit code ${rollbackRun.exitCode ?? "null"}`;
      }
      result.rollback = rollback;
      result.success = rollback.success;
    }
  }

  return result;
}

type RunDeployPhaseResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  runScriptApplied: string;
  runTimeoutMsApplied: number;
};

async function runDeployPhase(
  absRepo: string,
  runScript: string,
  defaultTimeoutMs: number,
  result: PullAndRunResult,
  onOutput: DeployOutputCallback | undefined,
  phase: "run" | "rollback"
): Promise<RunDeployPhaseResult> {
  let effectiveRunScript = runScript;
  let runTimeoutMs = defaultTimeoutMs;
  if (hasShiphookConfigFile(absRepo)) {
    const fresh = loadConfig(process.env, { cwd: absRepo });
    const multiMode = fresh.apps.length > 1 || (fresh.apps.length === 1 && fresh.apps[0]?.host !== "");
    // In multi-app mode, request routing already chose the app-specific script/timeout.
    if (!multiMode) {
      effectiveRunScript = fresh.runScript;
      runTimeoutMs = fresh.runTimeoutMs;
    }
  }

  const trimmed = effectiveRunScript.trim();
  const deadline = Date.now() + runTimeoutMs;
  const lines = splitRunScriptLines(trimmed);
  let runExitCode: number | null;
  let runStdout = "";
  let runStderr = "";

  if (lines.length === 0) {
    const r = await runOneLine("npm run deploy", absRepo, Math.max(0, deadline - Date.now()), result, onOutput, phase);
    runStdout = r.stdout;
    runStderr = r.stderr;
    runExitCode = r.exitCode;
  } else if (lines.length === 1) {
    const r = await runOneLine(lines[0]!, absRepo, Math.max(0, deadline - Date.now()), result, onOutput, phase);
    runStdout = r.stdout;
    runStderr = r.stderr;
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
        onOutput?.(phase, "stderr", timeoutMsg);
        allErr += timeoutMsg;
        runStdout = allOut;
        runStderr = allErr;
        runExitCode = null;
        break;
      }
      const r = await runOneLine(line, absRepo, remaining, result, onOutput, phase);
      allOut += r.stdout;
      allErr += r.stderr;
      if (r.exitCode !== 0 || r.exitCode === null) {
        runStdout = allOut;
        runStderr = allErr;
        runExitCode = r.exitCode;
        break;
      }
    }
    if (runExitCode === 0) {
      runStdout = allOut;
      runStderr = allErr;
    }
  }

  return {
    stdout: runStdout,
    stderr: runStderr,
    exitCode: runExitCode,
    runScriptApplied: effectiveRunScript,
    runTimeoutMsApplied: runTimeoutMs,
  };
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
  if (/^(set|export|unset|alias|cd|echo)$/.test(first)) return true;
  return false;
}

async function runOneLine(
  line: string,
  cwd: string,
  timeoutMs: number,
  result: PullAndRunResult,
  onOutput: DeployOutputCallback | undefined,
  phase: DeployOutputPhase
): Promise<RunChildOutcome> {
  const t = line.trim();
  if (!t) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  if (lineNeedsShell(t)) {
    return runShellScriptLine(t, cwd, timeoutMs, result, onOutput, phase);
  }
  const [cmd, args] = parseScript(t);
  const child = spawn(cmd, args, {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return runChildProcess(child, timeoutMs, result, onOutput, phase);
}

async function runShellScriptLine(
  script: string,
  cwd: string,
  timeoutMs: number,
  result: PullAndRunResult,
  onOutput: DeployOutputCallback | undefined,
  phase: DeployOutputPhase
): Promise<RunChildOutcome> {
  const child = spawn(script, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return runChildProcess(child, timeoutMs, result, onOutput, phase);
}

/**
 * Wires stdout/stderr, optional timeout, and exit code for a spawned child (with or without shell).
 */
function runChildProcess(
  child: ChildProcess,
  timeoutMs: number,
  result: PullAndRunResult,
  onOutput: DeployOutputCallback | undefined,
  phase: DeployOutputPhase
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
      timedOut = true;
      timeoutMsg = `run script timed out after ${timeoutMs}ms`;
      onOutput?.(phase, "stderr", timeoutMsg);
      result.error = (result.error ?? "") + timeoutMsg;

      child.kill("SIGTERM");

      killEscalationId = setTimeout(() => {
        if (settled) return;
        child.kill("SIGKILL");
      }, 5_000);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stdout += s;
      onOutput?.(phase, "stdout", s);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderr += s;
      onOutput?.(phase, "stderr", s);
    });
    child.on("close", (code) => {
      settle(code);
    });
    child.on("error", (err) => {
      const msg = err.message ?? String(err);
      stderr += msg;
      result.error = (result.error ?? "") + msg;
      onOutput?.(phase, "stderr", msg);
      settle(null);
    });
  });
}
