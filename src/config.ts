import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

const CONFIG_FILES = ["shiphook.yaml", "shiphook.yml", ".shiphook.yaml", ".shiphook.yml"];

interface YamlConfig {
  port?: number;
  repoPath?: string;
  repo_path?: string;
  runScript?: string;
  run_script?: string;
  secret?: string;
  path?: string;
}

function findConfigFile(cwd: string, configPath?: string): string | null {
  if (configPath) {
    const p = join(cwd, configPath);
    return existsSync(p) ? p : null;
  }
  for (const name of CONFIG_FILES) {
    const p = join(cwd, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function loadYamlConfig(filePath: string): Partial<ShiphookConfig> {
  const raw = readFileSync(filePath, "utf-8");
  const data = parse(raw) as YamlConfig | null;
  if (!data || typeof data !== "object") return {};
  return {
    port: data.port,
    repoPath: data.repoPath ?? data.repo_path,
    runScript: data.runScript ?? data.run_script,
    secret: data.secret,
    path: data.path,
  };
}

function applyDefaults(partial: Partial<ShiphookConfig>, cwd: string): ShiphookConfig {
  return {
    port: partial.port ?? DEFAULT_PORT,
    repoPath: partial.repoPath ?? cwd,
    runScript: partial.runScript ?? DEFAULT_RUN_SCRIPT,
    secret: partial.secret,
    path: partial.path ?? DEFAULT_PATH,
  };
}

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

  return {
    port: env.SHIPHOOK_PORT ? parseInt(env.SHIPHOOK_PORT, 10) : base.port!,
    repoPath: env.SHIPHOOK_REPO_PATH ?? base.repoPath!,
    runScript: env.SHIPHOOK_RUN_SCRIPT ?? base.runScript!,
    secret: env.SHIPHOOK_SECRET ?? base.secret,
    path: env.SHIPHOOK_PATH ?? base.path!,
  };
}
