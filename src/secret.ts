import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ShiphookConfig } from "./config.js";

const DEFAULT_SECRET_FILE = ".shiphook.secret";
const MULTI_SECRET_DIR = ".shiphook";

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export type EnsureSecretResult = {
  secretFilePath: string;
  source: "env" | "yaml" | "file" | "generated";
};

export type EnsureAppSecretsResult = {
  appName: string;
  host: string;
  path: string;
  secretFilePath: string;
  source: "yaml" | "file" | "generated";
};

function toFileSafeName(raw: string): string {
  const slug = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "app";
}

function appSecretFilePath(repoPath: string, host: string, path: string): string {
  // Stable identity: host + path (independent from `apps[].name` so renames don't rotate secrets).
  const canonical = `${host}|${path}`;
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  // Readable prefix based on host/path only; hash provides fixed-length uniqueness.
  const label = toFileSafeName(`${host}-${path}`);
  return join(repoPath, MULTI_SECRET_DIR, `${label}-${hash}.secret`);
}

/**
 * Ensures `config.secret` is a non-empty string, generating and persisting it if needed.
 *
 * Persistence location:
 * - `${config.repoPath}/.shiphook.secret`
 *
 * Source detection:
 * - If `config.secret` already exists (from env or YAML), it is used as-is.
 * - Otherwise we try to read `.shiphook.secret`.
 * - If missing, we generate a secure random value and write it to disk.
 */
export async function ensureWebhookSecret(
  config: ShiphookConfig,
  options?: { secretFileName?: string }
): Promise<EnsureSecretResult> {
  if (nonEmptyString(config.secret.trim())) {
    // Best-effort classification: if SHIPHOOK_SECRET env is set, assume env; otherwise yaml.
    // (loadConfig already validated non-empty values.)
    const source: EnsureSecretResult["source"] = process.env.SHIPHOOK_SECRET
      ? "env"
      : "yaml";
    return {
      secretFilePath: join(config.repoPath, options?.secretFileName ?? DEFAULT_SECRET_FILE),
      source,
    };
  }

  const secretFilePath = join(config.repoPath, options?.secretFileName ?? DEFAULT_SECRET_FILE);

  if (existsSync(secretFilePath)) {
    const onDisk = (await readFile(secretFilePath, "utf-8")).trim();
    if (nonEmptyString(onDisk)) {
      config.secret = onDisk;
      return { secretFilePath, source: "file" };
    }

    console.warn(
      `shiphook: existing secret file is empty; generating a new secret at ${secretFilePath}`
    );
  }

  // 32 bytes -> 64 hex chars; URL-safe and header-safe.
  const generated = randomBytes(32).toString("hex");
  config.secret = generated;
  await writeFile(secretFilePath, generated + "\n", { encoding: "utf-8", mode: 0o600 });
  return { secretFilePath, source: "generated" };
}

/** Ensures per-app secrets exist in multi-app mode. */
export async function ensureWebhookSecrets(config: ShiphookConfig): Promise<EnsureAppSecretsResult[]> {
  const apps = config.apps;
  if (apps.length <= 1 && !apps[0]?.host) return [];

  const results: EnsureAppSecretsResult[] = [];
  for (const app of apps) {
    if (nonEmptyString(app.secret.trim())) {
      results.push({
        appName: app.name,
        host: app.host,
        path: app.path,
        secretFilePath: appSecretFilePath(app.repoPath, app.host, app.path),
        source: "yaml",
      });
      continue;
    }

    const secretFilePath = appSecretFilePath(app.repoPath, app.host, app.path);
    if (existsSync(secretFilePath)) {
      const onDisk = (await readFile(secretFilePath, "utf-8")).trim();
      if (nonEmptyString(onDisk)) {
        app.secret = onDisk;
        results.push({
          appName: app.name,
          host: app.host,
          path: app.path,
          secretFilePath,
          source: "file",
        });
        continue;
      }
      console.warn(
        `shiphook: existing app secret file is empty; generating a new secret at ${secretFilePath}`
      );
    }

    await mkdir(join(app.repoPath, MULTI_SECRET_DIR), { recursive: true });
    const generated = randomBytes(32).toString("hex");
    app.secret = generated;
    await writeFile(secretFilePath, generated + "\n", { encoding: "utf-8", mode: 0o600 });
    results.push({
      appName: app.name,
      host: app.host,
      path: app.path,
      secretFilePath,
      source: "generated",
    });
  }

  return results;
}

