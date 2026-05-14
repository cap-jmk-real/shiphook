import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createShiphookServer } from "./server.js";
import type { ShiphookConfig } from "./config.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";

async function post(
  port: number,
  path: string,
  secret?: string,
  authorizationBearerSecret?: string,
  opts?: { asText?: boolean }
): Promise<{ status: number; body: unknown }> {
  const url = new URL(`http://127.0.0.1:${port}${path}`);
  const headers: Record<string, string> = {};
  if (secret) headers["X-Shiphook-Secret"] = secret;
  if (authorizationBearerSecret) headers["Authorization"] = `Bearer ${authorizationBearerSecret}`;
  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
  });
  const body = opts?.asText ? await res.text() : await res.json();
  return { status: res.status, body };
}

describe("createShiphookServer", () => {
  let testDir: string;
  let config: ShiphookConfig;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "shiphook-server-test-"));
    execSync("git init", { cwd: testDir });
    execSync("git config user.email 't@t.com'", { cwd: testDir });
    execSync("git config user.name 'Test'", { cwd: testDir });
    await writeFile(join(testDir, "deploy.js"), "console.log('ok');");
    config = {
      port: 0,
      repoPath: testDir,
      runScript: "node deploy.js",
      runTimeoutMs: 1000,
      path: "/",
      secret: "test-secret",
      rollbackOnFailure: false,
    };
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("responds 404 for GET", async () => {
    const server = createShiphookServer({ ...config, port: 3142 });
    await server.start();
    try {
      const res = await fetch("http://127.0.0.1:3142/");
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it("responds 404 for POST to wrong path", async () => {
    const server = createShiphookServer({ ...config, port: 3143 });
    await server.start();
    try {
      const { status } = await post(3143, "/other");
      expect(status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it("runs pull and script on POST and returns 200 with result", async () => {
    const server = createShiphookServer({ ...config, port: 3144 });
    await server.start();
    try {
      const { status, body } = await post(3144, "/?format=json", "test-secret");
      expect(status).toBe(200);
      const b = body as { ok: boolean; run?: { stdout?: string }; log?: { id?: string; json?: string } };
      expect(b.ok).toBe(true);
      expect(b.run?.stdout?.trim()).toBe("ok");
      expect(b.log?.id).toBeDefined();
      expect(b.log?.json).toBe(`.shiphook/logs/${b.log?.id}.json`);

      const jsonAbsPath = join(testDir, b.log?.json ?? "");
      const onDisk = JSON.parse((await readFile(jsonAbsPath, "utf-8")).toString()) as {
        id: string;
        run: { stdout: string };
      };
      expect(onDisk.id).toBe(b.log?.id);
      expect(onDisk.run.stdout.trim()).toBe("ok");
    } finally {
      await server.stop();
    }
  });

  it("rejects POST when secret is required and missing", async () => {
    const server = createShiphookServer({
      ...config,
      port: 3145,
      secret: "required-secret",
    });
    await server.start();
    try {
      const { status } = await post(3145, "/?format=json");
      expect(status).toBe(401);
      const { status: status2 } = await post(3145, "/?format=json", "required-secret");
      expect(status2).toBe(200);

      const { status: status3 } = await post(3145, "/?format=json", undefined, "required-secret");
      expect(status3).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it("streams deploy output by default and ends with a [done] line", async () => {
    const server = createShiphookServer({ ...config, port: 3146 });
    await server.start();
    try {
      const { status, body } = await post(3146, "/", "test-secret", undefined, { asText: true });
      expect(status).toBe(200);
      const text = body as string;
      const trimmed = text.trimEnd();
      const lastLine = trimmed.split("\n").at(-1) ?? "";
      expect(lastLine).toMatch(/\[done\]\s+ok=true\s+exitCode=0/);
      expect(text).toContain("[run] stdout:");
      expect(text).toContain("ok");
    } finally {
      await server.stop();
    }
  });

  it("reloads shiphook.yaml on every request when enabled", async () => {
    const deployOnePath = join(testDir, "deploy-one.js");
    const deployTwoPath = join(testDir, "deploy-two.js");
    await writeFile(deployOnePath, "console.log('one');");
    await writeFile(deployTwoPath, "console.log('two');");

    const writeYaml = async (secret: string, runScript: string) => {
      const yaml = [
        `secret: ${secret}`,
        `runScript: ${runScript}`,
        `runTimeoutMs: 1000`,
        `path: /`,
      ].join("\n");
      await writeFile(join(testDir, "shiphook.yaml"), yaml);
    };

    // Prevent env overrides so the test depends only on shiphook.yaml.
    const envKeys = [
      "SHIPHOOK_SECRET",
      "SHIPHOOK_RUN_SCRIPT",
      "SHIPHOOK_REPO_PATH",
      "SHIPHOOK_RUN_TIMEOUT_MS",
      "SHIPHOOK_PATH",
      "SHIPHOOK_PORT",
      "SHIPHOOK_CONFIG",
      "SHIPHOOK_RELOAD_CONFIG_EACH_REQUEST",
    ] as const;
    const savedEnv: Record<string, string | undefined> = {};
    for (const k of envKeys) savedEnv[k] = process.env[k];
    for (const k of envKeys) delete process.env[k];

    await writeYaml("yaml-secret-1", "node deploy-one.js");

    const server = createShiphookServer(
      {
        ...config,
        port: 3147,
        repoPath: testDir,
        runScript: "node deploy-one.js",
        runTimeoutMs: 1000,
        path: "/",
        secret: "yaml-secret-1",
        rollbackOnFailure: false,
      },
      { reloadConfigEachRequest: true, reloadConfigCwd: testDir }
    );

    await server.start();
    try {
      const res1 = await post(3147, "/", "yaml-secret-1", undefined, { asText: true });
      expect(res1.status).toBe(200);
      const text1 = res1.body as string;
      expect(text1).toContain("[run] stdout: one");
      expect(text1).toMatch(/\[done\]\s+ok=true\s+exitCode=0/);

      // Update the YAML and verify the next request uses the new runScript/secret.
      await writeYaml("yaml-secret-2", "node deploy-two.js");

      const res2 = await post(3147, "/", "yaml-secret-2", undefined, { asText: true });
      expect(res2.status).toBe(200);
      const text2 = res2.body as string;
      expect(text2).toContain("[run] stdout: two");
      expect(text2).toMatch(/\[done\]\s+ok=true\s+exitCode=0/);
    } finally {
      await server.stop();
      for (const k of envKeys) {
        const v = savedEnv[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("runs concurrent POSTs in FIFO order on the same repo", async () => {
    const seqPath = join(testDir, "seq.log");
    await rm(seqPath, { force: true });
    await rm(join(testDir, "shiphook.yaml"), { force: true });
    await writeFile(
      join(testDir, "seq.js"),
      `const fs=require('fs');
const p=${JSON.stringify(seqPath)};
const n=fs.existsSync(p)?parseInt(fs.readFileSync(p,'utf8'),10)+1:1;
fs.writeFileSync(p,String(n));
console.log('seq='+n);`
    );

    const server = createShiphookServer({ ...config, port: 3148, runScript: "node seq.js" });
    await server.start();
    try {
      const [res1, res2] = await Promise.all([
        post(3148, "/?format=json", "test-secret"),
        post(3148, "/?format=json", "test-secret"),
      ]);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      const b1 = res1.body as { run?: { stdout?: string }; queue?: { position?: number } };
      const b2 = res2.body as { run?: { stdout?: string }; queue?: { position?: number } };
      expect(b1.queue?.position).toBe(1);
      expect(b2.queue?.position).toBe(2);
      expect(b1.run?.stdout).toContain("seq=1");
      expect(b2.run?.stdout).toContain("seq=2");
    } finally {
      await server.stop();
    }
  });

  it("streams queue position while waiting in text mode", async () => {
    await rm(join(testDir, "shiphook.yaml"), { force: true });
    await writeFile(
      join(testDir, "slow.js"),
      "setTimeout(() => { console.log('done'); }, 400);"
    );

    const server = createShiphookServer({
      ...config,
      port: 3150,
      runScript: "node slow.js",
      runTimeoutMs: 5000,
    });
    await server.start();
    try {
      const [res1, res2] = await Promise.all([
        post(3150, "/", "test-secret", undefined, { asText: true }),
        post(3150, "/", "test-secret", undefined, { asText: true }),
      ]);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      const text1 = res1.body as string;
      const text2 = res2.body as string;
      expect(text1).toContain("[start] shiphook deploy");
      expect(text1).not.toContain("[queued]");
      expect(text2).toContain("[queued] waiting; position=2");
      expect(text2).toContain("[start] shiphook deploy");
      expect(text2).toMatch(/\[done\]\s+ok=true\s+exitCode=0\s+queuePosition=2/);
    } finally {
      await server.stop();
    }
  });

  it("includes rollback in JSON when deploy fails and rollbackOnFailure is enabled", async () => {
    const rollbackDir = await mkdtemp(join(tmpdir(), "shiphook-server-rollback-"));
    const remote = join(tmpdir(), `shiphook-server-remote-${Date.now()}.git`);
    try {
      execSync(`git init --bare "${remote}"`);
      execSync("git init", { cwd: rollbackDir });
      execSync("git config user.email 't@t.com'", { cwd: rollbackDir });
      execSync("git config user.name 'Test'", { cwd: rollbackDir });
      execSync(`git remote add origin "${remote}"`, { cwd: rollbackDir });
      await writeFile(join(rollbackDir, "deploy.js"), "console.log('ok');");
      execSync("git add deploy.js && git commit -m good", { cwd: rollbackDir, shell: "/bin/sh" });
      execSync("git branch -M main", { cwd: rollbackDir });
      execSync("git push -u origin main", { cwd: rollbackDir });
      const goodSha = execSync("git rev-parse HEAD", { cwd: rollbackDir }).toString().trim();

      await writeFile(join(rollbackDir, "deploy.js"), "process.exit(9);");
      execSync("git add deploy.js && git commit -m bad", { cwd: rollbackDir, shell: "/bin/sh" });
      execSync("git push origin main", { cwd: rollbackDir });
      execSync(`git reset --hard ${goodSha}`, { cwd: rollbackDir });

      const server = createShiphookServer({
        ...config,
        repoPath: rollbackDir,
        port: 3149,
        runScript: "node deploy.js",
        rollbackOnFailure: true,
      });
      await server.start();
      try {
        const { status, body } = await post(3149, "/?format=json", "test-secret");
        expect(status).toBe(200);
        const b = body as {
          ok: boolean;
          rollback?: { attempted: boolean; success: boolean };
        };
        expect(b.ok).toBe(true);
        expect(b.rollback?.attempted).toBe(true);
        expect(b.rollback?.success).toBe(true);
      } finally {
        await server.stop();
      }
    } finally {
      await rm(rollbackDir, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });
});
