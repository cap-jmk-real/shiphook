/**
 * Shiphook programmatic API: config loading, server creation, and pull-and-run.
 * Use these when embedding Shiphook in another Node process; for CLI, run the `shiphook` binary.
 */
export { loadConfig, type ShiphookConfig } from "./config.js";
export { createShiphookServer } from "./server.js";
export { pullAndRun, type PullAndRunResult } from "./pull-and-run.js";
