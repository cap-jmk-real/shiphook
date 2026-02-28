import { describe, it, expect } from "vitest";
import { pullAndRun } from "./pull-and-run.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

describe("pullAndRun", () => {
  it("runs script in given directory and captures output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-test-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email 't@t.com'", { cwd: dir });
      execSync("git config user.name 'Test'", { cwd: dir });
      await writeFile(join(dir, "deploy.js"), "console.log('deployed');");
      const result = await pullAndRun(dir, "node deploy.js");
      expect(result.runStdout.trim()).toBe("deployed");
      expect(result.runExitCode).toBe(0);
      expect(result.success).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports failure when run script exits non-zero", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-test-"));
    try {
      execSync("git init", { cwd: dir });
      await writeFile(join(dir, "fail.js"), "process.exit(7);");
      const result = await pullAndRun(dir, "node fail.js");
      expect(result.success).toBe(false);
      expect(result.runExitCode).toBe(7);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
