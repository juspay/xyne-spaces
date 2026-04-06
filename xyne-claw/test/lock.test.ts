/**
 * lock.test.ts — tests for the file-based advisory lock
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireFileLock } from "../src/lock.js";

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `leaf-lock-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("acquireFileLock", () => {
  it("creates and releases a lock file", async () => {
    const session = join(dir, "session.jsonl");
    const lockFile = `${session}.lock`;

    const lock = await acquireFileLock(session);
    expect(existsSync(lockFile)).toBe(true);

    await lock.release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it("second acquire waits for first release", async () => {
    const session = join(dir, "session.jsonl");
    const order: number[] = [];

    const lock1 = await acquireFileLock(session);
    order.push(1);

    // Start second acquire in background — should wait
    const p2 = acquireFileLock(session).then(async (lock2) => {
      order.push(2);
      await lock2.release();
    });

    // Small delay then release first
    await new Promise(r => setTimeout(r, 50));
    await lock1.release();

    await p2;
    expect(order).toEqual([1, 2]);
  });

  it("reclaims a stale lock from dead PID", async () => {
    const session = join(dir, "session.jsonl");
    const lockFile = `${session}.lock`;

    // Write a fake lock with a dead PID (99999 almost certainly not alive)
    const { writeFileSync } = await import("node:fs");
    writeFileSync(lockFile, JSON.stringify({ pid: 99999, ts: Date.now() }));

    // Should succeed by reclaiming the stale lock
    const lock = await acquireFileLock(session);
    expect(existsSync(lockFile)).toBe(true);
    await lock.release();
  });

  it("reclaims a lock older than STALE_MS", async () => {
    const session = join(dir, "session.jsonl");
    const lockFile = `${session}.lock`;

    // Write a fake lock with current PID but old timestamp
    const { writeFileSync } = await import("node:fs");
    const oldTs = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, ts: oldTs }));

    const lock = await acquireFileLock(session);
    expect(existsSync(lockFile)).toBe(true);
    await lock.release();
  });
});
