#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createShiphookServer } from "./server.js";

function main() {
  const config = loadConfig();
  const server = createShiphookServer(config);
  server.start().then(() => {
    const path = config.path === "/" ? "" : config.path;
    console.log(`Shiphook listening on http://localhost:${config.port}${path}`);
    console.log(`  Repo: ${config.repoPath}`);
    console.log(`  Run:  ${config.runScript}`);
    if (config.secret) console.log(`  Auth: secret set`);
  });
}

main();
