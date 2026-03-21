import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hasShiphookConfigFile, loadConfig } from "./config.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tmpdir } from "node:os";

async function withTempDir(callback: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "shiphook-config-"));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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
    expect(config.secret).toBe("");
    expect(config.path).toBe("/");
  });

  it("reads SHIPHOOK_PORT", () => {
    process.env.SHIPHOOK_PORT = "4000";
    const config = loadConfig(process.env);
    expect(config.port).toBe(4000);
  });

  it("rejects malformed SHIPHOOK_PORT and uses default", () => {
    process.env.SHIPHOOK_PORT = "5000abc";
    const config = loadConfig(process.env);
    expect(config.port).toBe(3141);
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

  it("loads from shiphook.yaml when present", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "shiphook.yaml"),
        "port: 4000\nrepoPath: /var/app\nrunScript: pnpm deploy\npath: /deploy\n"
      );
      delete process.env.SHIPHOOK_PORT;
      delete process.env.SHIPHOOK_REPO_PATH;
      delete process.env.SHIPHOOK_RUN_SCRIPT;
      delete process.env.SHIPHOOK_PATH;
      delete process.env.SHIPHOOK_CONFIG;
      const config = loadConfig(process.env, { cwd: dir });
      expect(config.port).toBe(4000);
      expect(config.repoPath).toBe("/var/app");
      expect(config.runScript).toBe("pnpm deploy");
      expect(config.path).toBe("/deploy");
    });
  });

  it("env overrides shiphook.yaml", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "shiphook.yaml"), "port: 4000\nrunScript: pnpm deploy\n");
      delete process.env.SHIPHOOK_CONFIG;
      process.env.SHIPHOOK_PORT = "5000";
      process.env.SHIPHOOK_RUN_SCRIPT = "yarn deploy";
      const config = loadConfig(process.env, { cwd: dir });
      expect(config.port).toBe(5000);
      expect(config.runScript).toBe("yarn deploy");
    });
  });

  it("accepts snake_case in shiphook.yaml (repo_path, run_script)", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "shiphook.yaml"),
        "port: 3000\nrepo_path: /opt/app\nrun_script: yarn build\npath: /hook\n"
      );
      delete process.env.SHIPHOOK_PORT;
      delete process.env.SHIPHOOK_REPO_PATH;
      delete process.env.SHIPHOOK_RUN_SCRIPT;
      delete process.env.SHIPHOOK_PATH;
      delete process.env.SHIPHOOK_CONFIG;
      const config = loadConfig(process.env, { cwd: dir });
      expect(config.port).toBe(3000);
      expect(config.repoPath).toBe("/opt/app");
      expect(config.runScript).toBe("yarn build");
      expect(config.path).toBe("/hook");
    });
  });

  it("SHIPHOOK_CONFIG points to custom config file path", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "custom.yaml"), "port: 9999\nrunScript: ./deploy.sh\n");
      process.env.SHIPHOOK_CONFIG = "custom.yaml";
      delete process.env.SHIPHOOK_PORT;
      delete process.env.SHIPHOOK_RUN_SCRIPT;
      const config = loadConfig(process.env, { cwd: dir });
      expect(config.port).toBe(9999);
      expect(config.runScript).toBe("./deploy.sh");
    });
  });

  it("ignores invalid YAML syntax and uses defaults", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "shiphook.yaml"), "port: 4000\n  bad: indentation\n");
      delete process.env.SHIPHOOK_PORT;
      delete process.env.SHIPHOOK_REPO_PATH;
      delete process.env.SHIPHOOK_RUN_SCRIPT;
      delete process.env.SHIPHOOK_PATH;
      delete process.env.SHIPHOOK_CONFIG;
      const config = loadConfig(process.env, { cwd: dir });
      expect(config.port).toBe(3141);
      expect(config.runScript).toBe("npm run deploy");
      expect(config.repoPath).toBe(dir);
    });
  });

  it("loads from .shiphook.yml when present", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, ".shiphook.yml"), "port: 5555\npath: /deploy\n");
      delete process.env.SHIPHOOK_PORT;
      delete process.env.SHIPHOOK_PATH;
      delete process.env.SHIPHOOK_CONFIG;
      const config = loadConfig(process.env, { cwd: dir });
      expect(config.port).toBe(5555);
      expect(config.path).toBe("/deploy");
    });
  });
});

describe("hasShiphookConfigFile", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("is true for default filenames inside cwd when SHIPHOOK_CONFIG is unset", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "shiphook.yaml"), "runScript: echo\n");
      delete process.env.SHIPHOOK_CONFIG;
      expect(hasShiphookConfigFile(dir)).toBe(true);
    });
  });

  it("is true when SHIPHOOK_CONFIG points to a file under cwd", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "deploy.yaml"), "runScript: echo\n");
      process.env.SHIPHOOK_CONFIG = "./deploy.yaml";
      expect(hasShiphookConfigFile(dir)).toBe(true);
    });
  });

  it("is false when SHIPHOOK_CONFIG resolves outside cwd (e.g. absolute external file)", async () => {
    await withTempDir(async (repo) => {
      const external = join(tmpdir(), `shiphook-external-${Date.now()}.yaml`);
      await writeFile(external, "runScript: echo ext\n");
      await writeFile(join(repo, "shiphook.yaml"), "runScript: echo repo\n");
      process.env.SHIPHOOK_CONFIG = external;
      expect(hasShiphookConfigFile(repo)).toBe(false);
      await rm(external, { force: true });
    });
  });
});
