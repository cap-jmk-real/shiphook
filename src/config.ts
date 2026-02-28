import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

export interface ShiphookConfig {
  /** Port for the webhook server (default: 3141) */
  port: number;
  /** Path to the repo to pull and run in (default: process.cwd()) */
  repoPath: string;
  /** Command to run after pull (default: "npm run deploy") */
  runScript: string;
  /** Secret for webhook auth; if set, request must have X-Shiphook-Secret or Authorization: Bearer <secret> */
  secret?: string;
  /** HTTP path for the webhook (default: "/") */
  path: string;
}

const DEFAULT_PORT = 3141;
const DEFAULT_RUN_SCRIPT = "npm run deploy";
const DEFAULT_PATH = "/";
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Returns true if value is a finite integer in the valid TCP port range (1–65535). */
function isValidPort(value: unknown): value is number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= MIN_PORT && n <= MAX_PORT && Math.floor(n) === n;
}

/** Type guard: true if value is a non-empty string. */
function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const CONFIG_FILES = ["shiphook.yaml", "shiphook.yml", ".shiphook.yaml", ".shiphook.yml"];

/** Raw shape accepted from YAML (camelCase and snake_case). */
interface YamlConfig {
  port?: number;
  repoPath?: string;
  repo_path?: string;
  runScript?: string;
  run_script?: string;
  secret?: string;
  path?: string;
}

/**
 * Locates a config file: if configPath is set, resolves it against cwd (supports absolute paths);
 * otherwise checks cwd for standard filenames (shiphook.yaml, .shiphook.yml, etc.).
 * @returns Absolute path to the first existing file, or null if none found.
 */
function findConfigFile(cwd: string, configPath?: string): string | null {
  if (configPath) {
    const p = resolve(cwd, configPath);
    return existsSync(p) ? p : null;
  }
  for (const name of CONFIG_FILES) {
    const p = join(cwd, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Reads and parses a YAML config file. Validates and sanitizes each field; only valid values
 * are included (e.g. port must be a finite integer in 1–65535, string fields must be non-empty).
 */
function loadYamlConfig(filePath: string): Partial<ShiphookConfig> {
  const raw = readFileSync(filePath, "utf-8");
  const data = parse(raw) as YamlConfig | null;
  if (!data || typeof data !== "object") return {};
  const result: Partial<ShiphookConfig> = {};
  const portVal = data.port;
  if (isValidPort(portVal)) result.port = Math.floor(Number(portVal));
  const repoPathVal = data.repoPath ?? data.repo_path;
  if (nonEmptyString(repoPathVal)) result.repoPath = repoPathVal;
  const runScriptVal = data.runScript ?? data.run_script;
  if (nonEmptyString(runScriptVal)) result.runScript = runScriptVal;
  const secretVal = data.secret;
  if (nonEmptyString(secretVal)) result.secret = secretVal;
  const pathVal = data.path;
  if (nonEmptyString(pathVal)) result.path = pathVal;
  return result;
}

/** Fills missing config fields with defaults (port, runScript, path, repoPath from cwd). */
function applyDefaults(partial: Partial<ShiphookConfig>, cwd: string): ShiphookConfig {
  return {
    port: partial.port ?? DEFAULT_PORT,
    repoPath: partial.repoPath ?? cwd,
    runScript: partial.runScript ?? DEFAULT_RUN_SCRIPT,
    secret: partial.secret,
    path: partial.path ?? DEFAULT_PATH,
  };
}

/**
 * Loads Shiphook config from environment variables and optional YAML file.
 * File is discovered in cwd (or path from SHIPHOOK_CONFIG). Env vars override file values.
 * Invalid or empty env values are ignored and fall back to file or defaults.
 *
 * @param env - Environment object (default: process.env). Keys: SHIPHOOK_PORT, SHIPHOOK_REPO_PATH,
 *   SHIPHOOK_RUN_SCRIPT, SHIPHOOK_SECRET, SHIPHOOK_PATH, SHIPHOOK_CONFIG.
 * @param options.cwd - Directory to search for config file; defaults to process.cwd().
 * @returns Resolved ShiphookConfig with defaults applied.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options?: { cwd?: string }
): ShiphookConfig {
  const cwd = options?.cwd ?? process.cwd();
  const configPath = env.SHIPHOOK_CONFIG;
  const filePath = findConfigFile(cwd, configPath);
  let base: Partial<ShiphookConfig> = {};
  if (filePath) {
    try {
      base = loadYamlConfig(filePath);
    } catch {
      // Invalid YAML or missing file: ignore, use env only
    }
  }
  base = applyDefaults(base, cwd);

  const portRaw = env.SHIPHOOK_PORT;
  const strictlyNumeric = typeof portRaw === "string" && /^\d+$/.test(portRaw);
  const envPort = strictlyNumeric ? parseInt(portRaw, 10) : undefined;
  const port = strictlyNumeric && isValidPort(envPort) ? envPort! : base.port ?? DEFAULT_PORT;
  return {
    port,
    repoPath: nonEmptyString(env.SHIPHOOK_REPO_PATH) ? env.SHIPHOOK_REPO_PATH : (base.repoPath ?? cwd),
    runScript: nonEmptyString(env.SHIPHOOK_RUN_SCRIPT) ? env.SHIPHOOK_RUN_SCRIPT : (base.runScript ?? DEFAULT_RUN_SCRIPT),
    secret: nonEmptyString(env.SHIPHOOK_SECRET) ? env.SHIPHOOK_SECRET : base.secret,
    path: nonEmptyString(env.SHIPHOOK_PATH) ? env.SHIPHOOK_PATH : (base.path ?? DEFAULT_PATH),
  };
}
