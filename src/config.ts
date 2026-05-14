import { readFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";

export interface ShiphookAppConfig {
  /** Human-readable app identifier for logs and summaries. */
  name: string;
  /** Domain name used for routing (lowercased). */
  host: string;
  /** HTTP path for this app's webhook route (normalized slash format). */
  path: string;
  /** Path to this app's repo to pull and run in. */
  repoPath: string;
  /** Command to run after pull for this app. */
  runScript: string;
  /** Per-app webhook secret. */
  secret: string;
  /** Max time (ms) for this app's deploy command. */
  runTimeoutMs: number;
}

export interface ShiphookConfig {
  /** Port for the webhook server (default: 3141) */
  port: number;
  /** Path to the repo to pull and run in (default: process.cwd()) */
  repoPath: string;
  /** Command to run after pull (default: "npm run deploy") */
  runScript: string;
  /** Max time (ms) to allow the runScript to finish before timing out (default: 30 minutes). */
  runTimeoutMs: number;
  /** Secret for webhook auth; must be a non-empty string */
  secret: string;
  /** HTTP path for the webhook (default: "/") */
  path: string;
  /** Multi-app mode routes. */
  apps: ShiphookAppConfig[];
  /** When true, failed deploys reset to pre-pull commit and re-run the deploy script (default: false). */
  rollbackOnFailure: boolean;
}

const DEFAULT_PORT = 3141;
const DEFAULT_RUN_SCRIPT = "npm run deploy";
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_PATH = "/";
const MIN_PORT = 1;
const MAX_PORT = 65535;
const MIN_RUN_TIMEOUT_MS = 1_000; // 1 second
const MAX_RUN_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Returns true if value is a finite integer in the valid TCP port range (1–65535). */
function isValidPort(value: unknown): value is number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= MIN_PORT && n <= MAX_PORT && Math.floor(n) === n;
}

/** Type guard: true if value is a non-empty string. */
function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Parses YAML/env booleans (true/false, 1/0, yes/no). */
function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
    if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  }
  return undefined;
}

/** Returns true if value is a finite integer in the valid timeout range. */
function isValidRunTimeoutMs(value: unknown): value is number {
  const n = typeof value === "number" ? value : Number(value);
  return (
    Number.isFinite(n) && n >= MIN_RUN_TIMEOUT_MS && n <= MAX_RUN_TIMEOUT_MS && Math.floor(n) === n
  );
}

const CONFIG_FILES = ["shiphook.yaml", "shiphook.yml", ".shiphook.yaml", ".shiphook.yml"];

/** Raw shape accepted from YAML (camelCase and snake_case). */
interface YamlConfig {
  port?: number;
  repoPath?: string;
  repo_path?: string;
  runScript?: string;
  run_script?: string;
  runTimeoutMs?: number;
  run_timeout_ms?: number;
  secret?: string;
  path?: string;
  rollbackOnFailure?: boolean;
  rollback_on_failure?: boolean;
  apps?: YamlAppConfig[];
}

interface YamlAppConfig {
  name?: string;
  host?: string;
  path?: string;
  repoPath?: string;
  repo_path?: string;
  runScript?: string;
  run_script?: string;
  runTimeoutMs?: number;
  run_timeout_ms?: number;
  secret?: string;
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
 * True when `resolvedFile` is the same path as, or contained under, `repoRoot` (both resolved).
 * Used so post-`git pull` reload only applies to repo-local YAML, not e.g. `SHIPHOOK_CONFIG=/etc/shiphook.yaml`.
 */
function isResolvedPathUnderRepoRoot(repoRoot: string, resolvedFile: string): boolean {
  const root = resolve(repoRoot);
  const file = resolve(resolvedFile);
  if (root === file) return true;
  const rel = relative(root, file);
  if (rel === "") return true;
  return !rel.startsWith("..");
}

function normalizePathValue(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return DEFAULT_PATH;
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
    return withLeadingSlash.slice(0, -1);
  }
  return withLeadingSlash;
}

function normalizeHostValue(host: string): string {
  const trimmed = host.trim().toLowerCase().replace(/\.$/, "");
  // strip optional :port suffix so config host matches HTTP Host parsing behavior
  return trimmed.replace(/:\d+$/, "");
}

function uniqueRoutingKey(host: string, path: string): string {
  return `${normalizeHostValue(host)}|${normalizePathValue(path)}`;
}

/**
 * True when a deploy can reload YAML from the repo tree after `git pull`.
 * Auto-detected filenames under `cwd` always qualify. If `SHIPHOOK_CONFIG` points outside `cwd`
 * (e.g. absolute path on another part of the filesystem), returns false so `pull-and-run` keeps
 * the pre-pull run script instead of re-reading that external file (which `git pull` never updates).
 */
export function hasShiphookConfigFile(cwd: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const configPath = env.SHIPHOOK_CONFIG;
  const filePath = findConfigFile(cwd, configPath);
  if (!filePath) return false;
  if (!configPath) {
    return true;
  }
  return isResolvedPathUnderRepoRoot(cwd, filePath);
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
  const timeoutVal = data.runTimeoutMs ?? data.run_timeout_ms;
  if (isValidRunTimeoutMs(timeoutVal)) result.runTimeoutMs = Math.floor(Number(timeoutVal));
  const secretVal = data.secret;
  if (nonEmptyString(secretVal)) result.secret = secretVal;
  const pathVal = data.path;
  if (nonEmptyString(pathVal)) result.path = normalizePathValue(pathVal);
  const rawApps = data.apps;
  if (Array.isArray(rawApps)) {
    const apps: ShiphookAppConfig[] = [];
    const seenRoutes = new Set<string>();
    for (let idx = 0; idx < rawApps.length; idx += 1) {
      const app = rawApps[idx];
      if (!app || typeof app !== "object") continue;

      const hostRaw = app.host;
      const secretRaw = app.secret;
      if (!nonEmptyString(hostRaw)) {
        throw new Error(
          `Invalid apps[${idx}] in shiphook config: each app needs non-empty host`
        );
      }
      const host = normalizeHostValue(hostRaw);
      if (!host) {
        throw new Error(`Invalid apps[${idx}] in shiphook config: host must not be empty`);
      }

      const path = normalizePathValue(nonEmptyString(app.path) ? app.path : DEFAULT_PATH);
      const routeKey = uniqueRoutingKey(host, path);
      if (seenRoutes.has(routeKey)) {
        throw new Error(
          `Duplicate app route in shiphook config for host "${host}" and path "${path}"`
        );
      }
      seenRoutes.add(routeKey);

      const repoPathVal = app.repoPath ?? app.repo_path;
      const runScriptVal = app.runScript ?? app.run_script;
      const timeoutVal = app.runTimeoutMs ?? app.run_timeout_ms;
      apps.push({
        name: nonEmptyString(app.name) ? app.name : `${host}${path === "/" ? "" : path}`,
        host,
        path,
        repoPath: nonEmptyString(repoPathVal) ? repoPathVal : ".",
        runScript: nonEmptyString(runScriptVal) ? runScriptVal : DEFAULT_RUN_SCRIPT,
        secret: nonEmptyString(secretRaw) ? secretRaw : "",
        runTimeoutMs: isValidRunTimeoutMs(timeoutVal)
          ? Math.floor(Number(timeoutVal))
          : DEFAULT_RUN_TIMEOUT_MS,
      });
    }
    result.apps = apps;
  }
  const rollbackVal = data.rollbackOnFailure ?? data.rollback_on_failure;
  const rollbackParsed = parseBoolean(rollbackVal);
  if (rollbackParsed !== undefined) result.rollbackOnFailure = rollbackParsed;
  return result;
}

/** Fills missing config fields with defaults (port, runScript, path, repoPath from cwd). */
function applyDefaults(partial: Partial<ShiphookConfig>, cwd: string): ShiphookConfig {
  const normalizedPath = partial.path ? normalizePathValue(partial.path) : DEFAULT_PATH;
  const normalizedApps =
    partial.apps?.map((app) => ({
      ...app,
      path: normalizePathValue(app.path),
      host: normalizeHostValue(app.host),
    })) ?? [];

  // Legacy single-app config becomes a one-entry apps array to keep runtime behavior unified.
  const apps =
    normalizedApps.length > 0
      ? normalizedApps
      : [
          {
            name: "default",
            host: "",
            path: normalizedPath,
            repoPath: partial.repoPath ?? cwd,
            runScript: partial.runScript ?? DEFAULT_RUN_SCRIPT,
            runTimeoutMs: partial.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
            secret: partial.secret ?? "",
          },
        ];

  return {
    port: partial.port ?? DEFAULT_PORT,
    repoPath: partial.repoPath ?? cwd,
    runScript: partial.runScript ?? DEFAULT_RUN_SCRIPT,
    runTimeoutMs: partial.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    secret: partial.secret ?? "",
    path: normalizedPath,
    apps,
    rollbackOnFailure: partial.rollbackOnFailure ?? false,
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
  let basePartial: Partial<ShiphookConfig> = {};
  if (filePath) {
    try {
      basePartial = loadYamlConfig(filePath);
    } catch (err) {
      // Invalid YAML syntax is non-fatal, but explicit config validation errors are fatal.
      const details = err instanceof Error ? err.message : String(err);
      if (
        details.includes("Invalid apps[") ||
        details.includes("Duplicate app route") ||
        details.includes("Invalid multi-app config")
      ) {
        throw err;
      }
      // Invalid YAML or missing file: ignore, use env only.
    }
  }

  const base = applyDefaults(basePartial, cwd);

  const portRaw = env.SHIPHOOK_PORT;
  const strictlyNumeric = typeof portRaw === "string" && /^\d+$/.test(portRaw);
  const envPort = strictlyNumeric ? parseInt(portRaw, 10) : undefined;
  const port = strictlyNumeric && isValidPort(envPort) ? envPort! : base.port ?? DEFAULT_PORT;

  const timeoutRaw = env.SHIPHOOK_RUN_TIMEOUT_MS;
  const strictlyNumericTimeout = typeof timeoutRaw === "string" && /^\d+$/.test(timeoutRaw);
  const envTimeout = strictlyNumericTimeout ? parseInt(timeoutRaw, 10) : undefined;
  const runTimeoutMs =
    strictlyNumericTimeout && isValidRunTimeoutMs(envTimeout)
      ? envTimeout!
      : base.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;

  const normalizedPath = nonEmptyString(env.SHIPHOOK_PATH)
    ? normalizePathValue(env.SHIPHOOK_PATH)
    : (base.path ?? DEFAULT_PATH);
  const singleRepoPath = nonEmptyString(env.SHIPHOOK_REPO_PATH)
    ? env.SHIPHOOK_REPO_PATH
    : (base.repoPath ?? cwd);
  const singleRunScript = nonEmptyString(env.SHIPHOOK_RUN_SCRIPT)
    ? env.SHIPHOOK_RUN_SCRIPT
    : (base.runScript ?? DEFAULT_RUN_SCRIPT);
  const singleSecret = nonEmptyString(env.SHIPHOOK_SECRET) ? env.SHIPHOOK_SECRET : base.secret;

  // Env overrides are only for legacy single-app shape; preserve explicit YAML apps as-is.
  const effectiveApps =
    base.apps.length > 1 || (base.apps.length === 1 && base.apps[0]?.host)
      ? base.apps
      : [
          {
            name: base.apps[0]?.name ?? "default",
            host: base.apps[0]?.host ?? "",
            path: normalizedPath,
            repoPath: singleRepoPath,
            runScript: singleRunScript,
            runTimeoutMs,
            secret: singleSecret,
          },
        ];

  const envRollback = parseBoolean(env.SHIPHOOK_ROLLBACK_ON_FAILURE);
  const rollbackOnFailure = envRollback !== undefined ? envRollback : base.rollbackOnFailure;

  return {
    port,
    repoPath: singleRepoPath,
    runScript: singleRunScript,
    runTimeoutMs,
    secret: singleSecret,
    path: normalizedPath,
    apps: effectiveApps,
    rollbackOnFailure,
  };
}
