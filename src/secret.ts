import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ShiphookConfig } from "./config.js";

const DEFAULT_SECRET_FILE = ".shiphook.secret";

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export type EnsureSecretResult = {
  secretFilePath: string;
  source: "env" | "yaml" | "file" | "generated";
};

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

