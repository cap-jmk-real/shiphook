import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("returns defaults when no env is set", () => {
    delete process.env.SHIPHOOK_PORT;
    delete process.env.SHIPHOOK_REPO_PATH;
    delete process.env.SHIPHOOK_RUN_SCRIPT;
    delete process.env.SHIPHOOK_SECRET;
    delete process.env.SHIPHOOK_PATH;
    const config = loadConfig(process.env);
    expect(config.port).toBe(3141);
    expect(config.repoPath).toBe(process.cwd());
    expect(config.runScript).toBe("npm run deploy");
    expect(config.secret).toBeUndefined();
    expect(config.path).toBe("/");
  });

  it("reads SHIPHOOK_PORT", () => {
    process.env.SHIPHOOK_PORT = "4000";
    const config = loadConfig(process.env);
    expect(config.port).toBe(4000);
  });

  it("reads SHIPHOOK_REPO_PATH and SHIPHOOK_RUN_SCRIPT", () => {
    process.env.SHIPHOOK_REPO_PATH = "/app/repo";
    process.env.SHIPHOOK_RUN_SCRIPT = "pnpm deploy";
    const config = loadConfig(process.env);
    expect(config.repoPath).toBe("/app/repo");
    expect(config.runScript).toBe("pnpm deploy");
  });

  it("reads SHIPHOOK_SECRET and SHIPHOOK_PATH", () => {
    process.env.SHIPHOOK_SECRET = "my-secret";
    process.env.SHIPHOOK_PATH = "/webhook";
    const config = loadConfig(process.env);
    expect(config.secret).toBe("my-secret");
    expect(config.path).toBe("/webhook");
  });
});
