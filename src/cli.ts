#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createShiphookServer } from "./server.js";
import { pullAndRun } from "./pull-and-run.js";
import { ensureWebhookSecret } from "./secret.js";
import { writeDeployLogs } from "./deploy-logs.js";

type CliCommand = "server" | "deploy";

function parseCommand(argv: string[]): CliCommand {
  const cmd = argv[2];
  if (cmd === "deploy") return "deploy";
  return "server";
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
  process.exit(result.success ? 0 : 1);
}

/**
 * Loads config (env + YAML), ensures auth secret for server mode, starts the webhook server,
 * and logs listen URL and settings.
 */
async function main() {
  const command = parseCommand(process.argv);
  if (command === "deploy") {
    await runDeploy();
    return;
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
  if (source === "generated") console.log(`  Webhook secret: ${config.secret}`);
  else console.log(`  Webhook secret: loaded (saved at ${secretFilePath})`);
}

main();
