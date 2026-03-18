import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ShiphookConfig } from "./config.js";
import { ensureWebhookSecret } from "./secret.js";

describe("ensureWebhookSecret", () => {
  it("generates a secret and persists it to .shiphook.secret", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-secret-test-"));
    try {
      const config: ShiphookConfig = {
        port: 0,
        repoPath: dir,
        runScript: "node deploy.js",
        path: "/",
      };

      const res1 = await ensureWebhookSecret(config);
      expect(res1.source).toBe("generated");
      expect(config.secret).toBeDefined();

      const onDisk = (await readFile(res1.secretFilePath, "utf-8")).trim();
      expect(onDisk).toBe(config.secret);

      const config2: ShiphookConfig = {
        ...config,
        secret: undefined,
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
        path: "/",
        secret: "env-or-yaml-secret",
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

