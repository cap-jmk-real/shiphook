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

  it("reports stdout/stderr to onOutput callback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-test-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email 't@t.com'", { cwd: dir });
      execSync("git config user.name 'Test'", { cwd: dir });
      await writeFile(join(dir, "deploy.js"), "console.log('deployed');");

      const stdoutChunks: string[] = [];
      const result = await pullAndRun(dir, "node deploy.js", {
        onOutput: (phase, stream, data) => {
          if (phase === "run" && stream === "stdout") stdoutChunks.push(data);
        },
      });

      expect(result.runStdout.trim()).toBe("deployed");
      expect(stdoutChunks.join("").includes("deployed")).toBe(true);
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

  it("reloads runScript from shiphook.yaml in repo after git pull when a config file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-test-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email 't@t.com'", { cwd: dir });
      execSync("git config user.name 'Test'", { cwd: dir });
      await writeFile(join(dir, "deploy.js"), "console.log('from-yaml');");
      await writeFile(join(dir, "shiphook.yaml"), "runScript: node deploy.js\n");
      const result = await pullAndRun(dir, "echo SHOULD_NOT_RUN");
      expect(result.runStdout.trim()).toBe("from-yaml");
      expect(result.runScriptApplied?.trim()).toBe("node deploy.js");
      expect(result.success).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs multiline runScript via shell (YAML | blocks)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-test-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email 't@t.com'", { cwd: dir });
      execSync("git config user.name 'Test'", { cwd: dir });
      const script = ["echo one", "echo two"].join("\n");
      const result = await pullAndRun(dir, script);
      expect(result.runStdout).toContain("one");
      expect(result.runStdout).toContain("two");
      expect(result.runExitCode).toBe(0);
      expect(result.success).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs single-line shell operators (e.g. &&) via shell", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-test-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email 't@t.com'", { cwd: dir });
      execSync("git config user.name 'Test'", { cwd: dir });
      const result = await pullAndRun(dir, "echo a && echo b");
      expect(result.runStdout).toContain("a");
      expect(result.runStdout).toContain("b");
      expect(result.runExitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("times out the run script when it exceeds the configured timeout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-test-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email 't@t.com'", { cwd: dir });
      execSync("git config user.name 'Test'", { cwd: dir });
      await writeFile(
        join(dir, "sleep.js"),
        "setTimeout(() => { console.log('done'); }, 5_000);"
      );

      const result = await pullAndRun(dir, "node sleep.js", { timeoutMs: 100 });
      expect(result.success).toBe(false);
      expect(result.runExitCode).toBeNull();
      expect(result.runStderr).toContain("run script timed out after");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rolls back to pre-pull commit and redeploys when rollbackOnFailure is enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-test-"));
    const remote = join(tmpdir(), `shiphook-remote-${Date.now()}.git`);
    try {
      execSync(`git init --bare "${remote}"`);
      execSync("git init", { cwd: dir });
      execSync("git config user.email 't@t.com'", { cwd: dir });
      execSync("git config user.name 'Test'", { cwd: dir });
      execSync(`git remote add origin "${remote}"`, { cwd: dir });
      await writeFile(join(dir, "deploy.js"), "console.log('v1');");
      execSync("git add deploy.js && git commit -m v1", { cwd: dir, shell: "/bin/sh" });
      execSync("git branch -M main", { cwd: dir });
      execSync("git push -u origin main", { cwd: dir });
      const goodSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();

      await writeFile(join(dir, "deploy.js"), "process.exit(1);");
      execSync("git add deploy.js && git commit -m v2-broken", { cwd: dir, shell: "/bin/sh" });
      execSync("git push origin main", { cwd: dir });
      execSync(`git reset --hard ${goodSha}`, { cwd: dir });

      const result = await pullAndRun(dir, "node deploy.js", { rollbackOnFailure: true });
      expect(result.success).toBe(true);
      expect(result.rollback?.attempted).toBe(true);
      expect(result.rollback?.success).toBe(true);
      expect(result.rollback?.prePullSha).toBe(goodSha);
      expect(result.rollback?.stdout).toContain("v1");
      expect(execSync("git rev-parse HEAD", { cwd: dir }).toString().trim()).toBe(goodSha);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it("does not roll back when rollbackOnFailure is disabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-test-"));
    try {
      execSync("git init", { cwd: dir });
      execSync("git config user.email 't@t.com'", { cwd: dir });
      execSync("git config user.name 'Test'", { cwd: dir });
      await writeFile(join(dir, "deploy.js"), "console.log('v1');");
      execSync("git add deploy.js && git commit -m v1", { cwd: dir, shell: "/bin/sh" });

      await writeFile(join(dir, "deploy.js"), "process.exit(1);");
      execSync("git add deploy.js && git commit -m v2", { cwd: dir, shell: "/bin/sh" });
      const badSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();

      const result = await pullAndRun(dir, "node deploy.js", { rollbackOnFailure: false });
      expect(result.success).toBe(false);
      expect(result.rollback).toBeUndefined();
      expect(execSync("git rev-parse HEAD", { cwd: dir }).toString().trim()).toBe(badSha);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("attempts rollback after run script timeout when rollbackOnFailure is enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-test-"));
    const remote = join(tmpdir(), `shiphook-remote-timeout-${Date.now()}.git`);
    try {
      execSync(`git init --bare "${remote}"`);
      execSync("git init", { cwd: dir });
      execSync("git config user.email 't@t.com'", { cwd: dir });
      execSync("git config user.name 'Test'", { cwd: dir });
      execSync(`git remote add origin "${remote}"`, { cwd: dir });
      await writeFile(join(dir, "run.js"), "console.log('ok');");
      execSync("git add run.js && git commit -m v1", { cwd: dir, shell: "/bin/sh" });
      execSync("git branch -M main", { cwd: dir });
      execSync("git push -u origin main", { cwd: dir });
      const goodSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();

      await writeFile(join(dir, "run.js"), "setTimeout(() => {}, 30_000);");
      execSync("git add run.js && git commit -m v2", { cwd: dir, shell: "/bin/sh" });
      execSync("git push origin main", { cwd: dir });
      execSync(`git reset --hard ${goodSha}`, { cwd: dir });

      const result = await pullAndRun(dir, "node run.js", {
        rollbackOnFailure: true,
        timeoutMs: 100,
      });
      expect(result.rollback?.attempted).toBe(true);
      expect(result.rollback?.prePullSha).toBe(goodSha);
      expect(execSync("git rev-parse HEAD", { cwd: dir }).toString().trim()).toBe(goodSha);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });
});
