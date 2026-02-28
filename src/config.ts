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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ShiphookConfig {
  return {
    port: env.SHIPHOOK_PORT ? parseInt(env.SHIPHOOK_PORT, 10) : DEFAULT_PORT,
    repoPath: env.SHIPHOOK_REPO_PATH ?? process.cwd(),
    runScript: env.SHIPHOOK_RUN_SCRIPT ?? DEFAULT_RUN_SCRIPT,
    secret: env.SHIPHOOK_SECRET,
    path: env.SHIPHOOK_PATH ?? DEFAULT_PATH,
  };
}
