import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import { parse as shellParse } from "shell-quote";

const execAsync = promisify(exec);

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
 * @returns Result with pull/run stdout, stderr, and success flags.
 */
export async function pullAndRun(
  repoPath: string,
  runScript: string
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

  try {
    const { stdout: pullStdout, stderr: pullStderr } = await execAsync("git pull", {
      cwd: repoPath,
      encoding: "utf8",
    });
    result.pullStdout = pullStdout ?? "";
    result.pullStderr = pullStderr ?? "";
    result.pullSuccess = true;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    result.pullStdout = e.stdout ?? "";
    result.pullStderr = e.stderr ?? "";
    result.error = e.message ?? String(err);
    // Still run the script so deploy can proceed (e.g. no remote configured)
  }

  const [cmd, args] = parseScript(runScript);
  const runExitCode = await runCommand(cmd, args, repoPath, result);
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
  timeoutMs: number = 60_000
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
      result.runStderr = stderr + msg;
      result.error = (result.error ?? "") + msg;
      resolve(null);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      settle(code);
    });
    child.on("error", (err) => {
      result.runStderr += err.message;
      result.error = (result.error ?? "") + err.message;
      settle(null);
    });
  });
}
