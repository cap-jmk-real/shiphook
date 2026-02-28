import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { exec } from "node:child_process";

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

/** Splits a script string into [command, args]. Empty string yields ["npm", ["run", "deploy"]]. */
function parseScript(script: string): [string, string[]] {
  const trimmed = script.trim();
  if (!trimmed) return ["npm", ["run", "deploy"]];
  const parts = trimmed.split(/\s+/);
  return [parts[0], parts.slice(1)];
}

/**
 * Spawns command with args in cwd, pipes stdout/stderr into result, and resolves with exit code
 * (or null on spawn error).
 */
function runCommand(
  command: string,
  args: string[],
  cwd: string,
  result: PullAndRunResult
): Promise<number | null> {
  return new Promise((resolve) => {
    // Avoid shell so exit codes propagate reliably on all platforms
    const useShell = command !== "node" && command !== "node.exe";
    const child = spawn(command, args, {
      cwd,
      shell: useShell,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code, signal) => {
      result.runStdout = stdout;
      result.runStderr = stderr;
      resolve(code);
    });
    child.on("error", (err) => {
      result.runStderr += err.message;
      result.error = (result.error ?? "") + err.message;
      resolve(null);
    });
  });
}
