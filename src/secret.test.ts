import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ShiphookConfig } from "./config.js";
import { ensureWebhookSecret, ensureWebhookSecrets } from "./secret.js";

describe("ensureWebhookSecret", () => {
  it("generates a secret and persists it to .shiphook.secret", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-secret-test-"));
    try {
      const config: ShiphookConfig = {
        port: 0,
        repoPath: dir,
        runScript: "node deploy.js",
        runTimeoutMs: 1000,
        path: "/",
        secret: "",
        apps: [
          {
            name: "default",
            host: "",
            path: "/",
            repoPath: dir,
            runScript: "node deploy.js",
            runTimeoutMs: 1000,
            secret: "",
          },
        ],
      };

      const res1 = await ensureWebhookSecret(config);
      expect(res1.source).toBe("generated");
      expect(config.secret).toBeDefined();

      const onDisk = (await readFile(res1.secretFilePath, "utf-8")).trim();
      expect(onDisk).toBe(config.secret);

      const config2: ShiphookConfig = {
        ...config,
        secret: "",
      };
      const res2 = await ensureWebhookSecret(config2);
      expect(res2.source).toBe("file");
      expect(config2.secret).toBe(onDisk);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses configured secret without reading/writing the secret file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-secret-test-"));
    try {
      const secretFilePath = join(dir, ".shiphook.secret");
      await writeFile(secretFilePath, "disk-secret\n");

      const config: ShiphookConfig = {
        port: 0,
        repoPath: dir,
        runScript: "node deploy.js",
        runTimeoutMs: 1000,
        path: "/",
        secret: "env-or-yaml-secret",
        apps: [
          {
            name: "default",
            host: "",
            path: "/",
            repoPath: dir,
            runScript: "node deploy.js",
            runTimeoutMs: 1000,
            secret: "env-or-yaml-secret",
          },
        ],
      };

      const res = await ensureWebhookSecret(config);
      expect(res.source === "env" || res.source === "yaml").toBe(true);
      expect(config.secret).toBe("env-or-yaml-secret");

      const onDisk = (await readFile(secretFilePath, "utf-8")).trim();
      expect(onDisk).toBe("disk-secret");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ensureWebhookSecrets (multi-app)", () => {
  it("generates and persists per-app secrets when missing", async () => {
    const dirA = await mkdtemp(join(tmpdir(), "shiphook-secret-app-a-"));
    const dirB = await mkdtemp(join(tmpdir(), "shiphook-secret-app-b-"));
    try {
      const config: ShiphookConfig = {
        port: 0,
        repoPath: dirA,
        runScript: "node deploy.js",
        runTimeoutMs: 1000,
        path: "/",
        secret: "",
        apps: [
          {
            name: "app-a",
            host: "a.example.com",
            path: "/deploy",
            repoPath: dirA,
            runScript: "npm run deploy",
            runTimeoutMs: 1000,
            secret: "",
          },
          {
            name: "app-b",
            host: "b.example.com",
            path: "/deploy",
            repoPath: dirB,
            runScript: "npm run deploy",
            runTimeoutMs: 1000,
            secret: "",
          },
        ],
      };

      const meta = await ensureWebhookSecrets(config);
      expect(meta).toHaveLength(2);
      expect(meta.every((m) => m.source === "generated")).toBe(true);
      expect(config.apps[0]?.secret.length).toBeGreaterThan(0);
      expect(config.apps[1]?.secret.length).toBeGreaterThan(0);

      const diskA = (await readFile(meta[0]!.secretFilePath, "utf-8")).trim();
      const diskB = (await readFile(meta[1]!.secretFilePath, "utf-8")).trim();
      expect(diskA).toBe(config.apps[0]?.secret);
      expect(diskB).toBe(config.apps[1]?.secret);
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });
});

