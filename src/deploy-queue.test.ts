import { describe, it, expect } from "vitest";
import { enqueueDeploy, getDeployQueueDepth } from "./deploy-queue.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("enqueueDeploy", () => {
  it("runs jobs on the same repo in FIFO order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-queue-"));
    try {
      const order: number[] = [];
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const p1 = enqueueDeploy(dir, async () => {
        order.push(1);
        await delay(50);
        return "a";
      });
      const p2 = enqueueDeploy(dir, async () => {
        order.push(2);
        return "b";
      });
      const p3 = enqueueDeploy(dir, async () => {
        order.push(3);
        return "c";
      });

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(order).toEqual([1, 2, 3]);
      expect(r1.result).toBe("a");
      expect(r2.result).toBe("b");
      expect(r3.result).toBe("c");
      expect(r2.queuePosition).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not block jobs on different repo paths", async () => {
    const dirA = await mkdtemp(join(tmpdir(), "shiphook-queue-a-"));
    const dirB = await mkdtemp(join(tmpdir(), "shiphook-queue-b-"));
    try {
      let aDone = false;
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const pA = enqueueDeploy(dirA, async () => {
        await delay(80);
        aDone = true;
        return "a";
      });
      const pB = enqueueDeploy(dirB, async () => {
        await delay(10);
        return "b";
      });

      const rB = await pB;
      expect(rB.result).toBe("b");
      expect(aDone).toBe(false);
      await pA;
      expect(aDone).toBe(true);
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });

  it("reports queue depth while jobs are waiting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shiphook-queue-depth-"));
    try {
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let queuedPosition = 0;

      const p1 = enqueueDeploy(dir, async () => {
        await delay(100);
        return 1;
      });
      const p2 = enqueueDeploy(
        dir,
        async () => 2,
        {
          onQueued: (position) => {
            queuedPosition = position;
          },
        }
      );

      await delay(10);
      expect(getDeployQueueDepth(dir)).toBeGreaterThanOrEqual(1);
      await Promise.all([p1, p2]);
      expect(queuedPosition).toBe(2);
      expect(getDeployQueueDepth(dir)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
