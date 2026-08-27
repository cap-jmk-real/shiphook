import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type DeploymentEvent = {
  id: string;
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  commit: string | null;
  ref: string | null;
  repository: string | null;
  error: string | null;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(raw: string | null): number {
  const parsed = raw === null ? DEFAULT_LIMIT : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

function sanitize(value: unknown, max = 500): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, max);
}

export async function readDeploymentEvents(repoPath: string, rawLimit: string | null): Promise<DeploymentEvent[]> {
  let files: string[];
  try {
    files = (await readdir(join(repoPath, ".shiphook", "logs")))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, clampLimit(rawLimit));
  } catch {
    return [];
  }

  const events: DeploymentEvent[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(await readFile(join(repoPath, ".shiphook", "logs", file), "utf8")) as Record<string, unknown>;
      const pull = (raw.pull ?? {}) as Record<string, unknown>;
      const run = (raw.run ?? {}) as Record<string, unknown>;
      const error = sanitize(raw.error);
      events.push({
        id: sanitize(raw.id, 200) ?? file.slice(0, -5),
        status: raw.ok === true ? "success" : "failed",
        startedAt: sanitize(raw.startedAt, 40) ?? "",
        finishedAt: sanitize(raw.finishedAt, 40) ?? "",
        durationMs: typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) ? raw.durationMs : 0,
        commit: sanitize(raw.commit, 200),
        ref: sanitize(raw.ref, 200),
        repository: sanitize(raw.repository, 300),
        error: error ?? sanitize(pull.stderr) ?? sanitize(run.stderr),
      });
    } catch {
      // Ignore incomplete or corrupt log files; one bad record must not break the feed.
    }
  }
  return events;
}

export { clampLimit };
