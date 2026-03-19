import { spawn } from "node:child_process";
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
 * @param runScript - Command string (e.g. "npm run deploy" or "pnpm deploy"); parsed into command + args.
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

  const [cmd, args] = parseScript(runScript);
  const runTimeoutMs = options?.timeoutMs ?? 30 * 60 * 1000; // default: 30 minutes
  const runExitCode = await runCommand(
    cmd,
    args,
    repoPath,
    result,
    runTimeoutMs,
    options?.onOutput
  );
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

/**
 * Spawns command with args in cwd (shell: false so exit codes propagate and args are not
 * interpreted by a shell), pipes stdout/stderr into result, and resolves with exit code
 * (or null on spawn error or timeout). Optional timeout kills the child and resolves null.
 */
function runCommand(
  command: string,
  args: string[],
  cwd: string,
  result: PullAndRunResult,
  timeoutMs: number = 30 * 60 * 1000, // 30 minutes
  onOutput?: DeployOutputCallback
): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      result.runStdout = stdout;
      result.runStderr = stderr;
      resolve(code);
    };
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      timeoutId = undefined;
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      const msg = `run script timed out after ${timeoutMs}ms`;
      onOutput?.("run", "stderr", msg);
      result.runStderr = stderr + msg;
      result.error = (result.error ?? "") + msg;
      resolve(null);
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
