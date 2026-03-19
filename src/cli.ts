#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createShiphookServer } from "./server.js";
import { pullAndRun } from "./pull-and-run.js";
import { ensureWebhookSecret } from "./secret.js";
import { writeDeployLogs } from "./deploy-logs.js";

type CliCommand = "server" | "deploy" | "setup-https";

function parseCommand(argv: string[]): CliCommand {
  const cmd = argv[2];
  if (cmd === "deploy") return "deploy";
  if (cmd === "setup-https") return "setup-https";
  return "server";
}

function setupHttpsScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "scripts", "setup-https.sh");
}

/** Runs the root setup script via sudo. Caller must ensure platform is Linux. */
function invokeSetupHttpsScript(): boolean {
  const script = setupHttpsScriptPath();
  if (!existsSync(script)) {
    console.error(`Missing setup script: ${script}`);
    return false;
  }
  const r = spawnSync("sudo", ["bash", script], { stdio: "inherit" });
  return r.status === 0;
}

/** `shiphook setup-https` — exit after run. */
function runSetupHttpsCliCommand(): void {
  if (process.platform !== "linux") {
    console.error(
      "shiphook setup-https only runs the automated installer on Linux (Debian/Ubuntu or RHEL-family, e.g. AlmaLinux, Rocky, RHEL, CentOS, Fedora)."
    );
    console.error("On other systems, configure nginx + certbot manually; see docs/self-hosted-https.md");
    process.exitCode = 1;
    return;
  }
  const ok = invokeSetupHttpsScript();
  process.exitCode = ok ? 0 : 1;
}

/** True when running in a typical CI/automation environment (suppress interactive prompts). */
function isLikelyCiEnvironment(): boolean {
  if (Object.hasOwn(process.env, "CI")) {
    const raw = process.env.CI;
    const v = (raw ?? "").trim().toLowerCase();
    // Explicit opt-out for odd local shells that export CI=false
    if (v === "false" || v === "0" || v === "no" || v === "off") return false;
    // Empty CI, CI=1, CI=true, CI=yes, or any other non-opt-out value → treat as CI
    return true;
  }
  const gh = process.env.GITHUB_ACTIONS;
  if (gh === "true" || gh === "1") return true;
  const gl = process.env.GITLAB_CI;
  if (gl === "true" || gl === "1") return true;
  return false;
}

function shouldOfferHttpsPrompt(): boolean {
  if (process.env.SHIPHOOK_SKIP_HTTPS_PROMPT === "1") return false;
  if (isLikelyCiEnvironment()) return false;
  if (process.platform !== "linux") return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  return true;
}

async function promptOfferHttpsSetup(): Promise<boolean> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const line = await rl.question(
      "Set up public HTTPS (nginx + Certbot) for GitHub-style webhooks? [y/N] "
    );
    const a = line.trim().toLowerCase();
    return a === "y" || a === "yes";
  } finally {
    rl.close();
  }
}

async function runDeploy() {
  const config = loadConfig();
  const startedAt = new Date();
  const result = await pullAndRun(config.repoPath, config.runScript);
  const finishedAt = new Date();

  let log: { id: string; json: string; log: string } | undefined;
  try {
    const files = await writeDeployLogs({
      repoPath: config.repoPath,
      runScript: config.runScript,
      startedAt,
      finishedAt,
      result,
    });
    log = {
      id: files.id,
      json: files.jsonPathRelativeToRepo,
      log: files.textPathRelativeToRepo,
    };
  } catch {
    // Ignore logging failures for manual deploy.
  }

  console.log(JSON.stringify({ ...result, log }, null, 2));
  // Let stdout flush before exiting.
  process.exitCode = result.success ? 0 : 1;
}

/**
 * Loads config (env + YAML), ensures auth secret for server mode, starts the webhook server,
 * and logs listen URL and settings.
 */
async function main() {
  const command = parseCommand(process.argv);
  if (command === "setup-https") {
    runSetupHttpsCliCommand();
    return;
  }
  if (command === "deploy") {
    await runDeploy();
    return;
  }

  if (shouldOfferHttpsPrompt()) {
    const wantsHttps = await promptOfferHttpsSetup();
    if (wantsHttps) {
      console.log("Starting HTTPS setup (sudo may ask for your password)…\n");
      const ok = invokeSetupHttpsScript();
      if (ok) {
        console.log("\nHTTPS setup finished. Starting Shiphook…\n");
      } else {
        console.warn(
          "\nHTTPS setup did not complete successfully. Starting Shiphook on HTTP anyway.\n"
        );
      }
    }
  }

  const config = loadConfig();
  const { source, secretFilePath } = await ensureWebhookSecret(config);

  const server = createShiphookServer(config);
  await server.start();

  const path = config.path === "/" ? "" : config.path;
  console.log(`Shiphook listening on http://localhost:${config.port}${path}`);
  console.log(`  Repo: ${config.repoPath}`);
  console.log(`  Run:  ${config.runScript}`);
  console.log(`  Auth: required (source: ${source})`);
  if (source === "generated") {
    console.log(`  Webhook secret: generated and saved at ${secretFilePath}`);
    console.log("");
    console.log("GitHub webhook “Secret” value (copy this once, keep it safe):");
    console.log(`  ${config.secret}`);
    console.log("");
  } else if (source === "file") {
    console.log(`  Webhook secret: loaded from ${secretFilePath}`);
  } else {
    // For env/yaml, ensureWebhookSecret() does not write a secret file.
    console.log(
      `  Webhook secret: loaded from ${source}; secret file path: ${secretFilePath} (not persisted by Shiphook for ${source})`
    );
  }
}

main();
