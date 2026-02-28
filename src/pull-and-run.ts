import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { exec } from "node:child_process";

const execAsync = promisify(exec);

export interface PullAndRunResult {
  success: boolean;
  pullSuccess: boolean;
  pullStdout: string;
  pullStderr: string;
  runStdout: string;
  runStderr: string;
  runExitCode: number | null;
  error?: string;
}

/**
 * Run `git pull` in repoPath, then execute runScript in the same directory.
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

function parseScript(script: string): [string, string[]] {
  const trimmed = script.trim();
  if (!trimmed) return ["npm", ["run", "deploy"]];
  const parts = trimmed.split(/\s+/);
  return [parts[0], parts.slice(1)];
}

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
