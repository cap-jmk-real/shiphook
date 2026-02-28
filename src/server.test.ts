import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createShiphookServer } from "./server.js";
import type { ShiphookConfig } from "./config.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

async function post(
  port: number,
  path: string,
  secret?: string
): Promise<{ status: number; body: unknown }> {
  const url = new URL(`http://127.0.0.1:${port}${path}`);
  const headers: Record<string, string> = {};
  if (secret) headers["X-Shiphook-Secret"] = secret;
  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
  });
  const body = await res.json();
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
      path: "/",
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
      const { status, body } = await post(3144, "/");
      expect(status).toBe(200);
      const b = body as { ok: boolean; run?: { stdout?: string } };
      expect(b.ok).toBe(true);
      expect(b.run?.stdout?.trim()).toBe("ok");
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
      const { status } = await post(3145, "/");
      expect(status).toBe(401);
      const { status: status2 } = await post(3145, "/", "required-secret");
      expect(status2).toBe(200);
    } finally {
      await server.stop();
    }
  });
});
