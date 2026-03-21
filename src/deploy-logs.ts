import { mkdir, writeFile } from "node:fs/promises";
import { join, posix as pathPosix } from "node:path";
import { randomUUID } from "node:crypto";
import type { PullAndRunResult } from "./pull-and-run.js";

export type DeployLogFiles = {
  id: string;
  jsonPathRelativeToRepo: string;
  textPathRelativeToRepo: string;
};

function getLogsDir(repoPath: string) {
  // Stored alongside other shiphook state inside the repo.
  return join(repoPath, ".shiphook", "logs");
}

function formatTimestampHumanUtc(d: Date): string {
  // Keep it stable and readable: `YYYY-MM-DD HH:mm:ss UTC`.
  const iso = d.toISOString(); // ends with `Z`
  const noMs = iso.replace(/\.\d{3}Z$/, "Z");
  return noMs.replace("T", " ").replace(/Z$/, " UTC");
}

/** UTC timestamp safe for filenames and directory sorting (no `:`). Example: `2025-03-21_14-30-45Z`. */
function formatTimestampForFilenameUtc(d: Date): string {
  const iso = d.toISOString();
  const noMs = iso.replace(/\.\d{3}Z$/, "Z");
  return noMs.replace(/T/g, "_").replace(/:/g, "-");
}

/**
 * Writes structured deploy logs (JSON + human-readable text) into `.shiphook/logs` inside repoPath.
 *
 * The JSON file is intended for tools/monitoring; the `.log` file is optimized for humans.
 * Filenames are `<UTC-date>_<id>.json` / `.log` so directory listings show when each deploy ran.
 * Call this after each deploy to keep a history of pull/run output.
 */
export async function writeDeployLogs(args: {
  repoPath: string;
  runScript: string;
  startedAt: Date;
  finishedAt: Date;
  result: PullAndRunResult;
  /** Optional suffix (e.g. fixed UUID) for deterministic filenames in tests. */
  id?: string;
}): Promise<DeployLogFiles> {
  const unique = args.id ?? randomUUID();
  const id = `${formatTimestampForFilenameUtc(args.startedAt)}_${unique}`;
  const logsDir = getLogsDir(args.repoPath);

  await mkdir(logsDir, { recursive: true });

  // Use POSIX separators so paths in JSON/text are consistent across OSes.
  const jsonPathRelativeToRepo = pathPosix.join(".shiphook", "logs", `${id}.json`);
  const textPathRelativeToRepo = pathPosix.join(".shiphook", "logs", `${id}.log`);

  const jsonAbsPath = join(args.repoPath, jsonPathRelativeToRepo);
  const textAbsPath = join(args.repoPath, textPathRelativeToRepo);

  const durationMs = Math.max(0, args.finishedAt.getTime() - args.startedAt.getTime());
  const startedAtHuman = formatTimestampHumanUtc(args.startedAt);
  const finishedAtHuman = formatTimestampHumanUtc(args.finishedAt);

  const payload = {
    id,
    startedAt: args.startedAt.toISOString(),
    finishedAt: args.finishedAt.toISOString(),
    durationMs,
    repoPath: args.repoPath,
    runScript: args.runScript,
    ok: args.result.success,
    pull: {
      success: args.result.pullSuccess,
      stdout: args.result.pullStdout,
      stderr: args.result.pullStderr,
    },
    run: {
      stdout: args.result.runStdout,
      stderr: args.result.runStderr,
      exitCode: args.result.runExitCode,
    },
    error: args.result.error ?? null,
  };

  await writeFile(jsonAbsPath, JSON.stringify(payload, null, 2), { encoding: "utf-8", mode: 0o600 });

  const text = [
    `shiphook deploy log: ${id}`,
    `startedAt: ${startedAtHuman}`,
    `finishedAt: ${finishedAtHuman}`,
    `durationMs: ${payload.durationMs}`,
    ``,
    `repoPath: ${payload.repoPath}`,
    `runScript: ${payload.runScript}`,
    `ok: ${payload.ok}`,
    `pull.success: ${payload.pull.success}`,
    `run.exitCode: ${payload.run.exitCode}`,
    `error: ${payload.error}`,
    ``,
    `--- git pull stdout ---`,
    payload.pull.stdout,
    ``,
    `--- git pull stderr ---`,
    payload.pull.stderr,
    ``,
    `--- run stdout ---`,
    payload.run.stdout,
    ``,
    `--- run stderr ---`,
    payload.run.stderr,
    ``,
  ].join("\n");

  await writeFile(textAbsPath, text, { encoding: "utf-8", mode: 0o600 });

  return {
    id,
    jsonPathRelativeToRepo,
    textPathRelativeToRepo,
  };
}

