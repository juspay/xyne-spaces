import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let root: string;
let store: typeof import("../src/session-store.js");

async function makeSessionDir(name: string, ageHours: number): Promise<string> {
  const dir = path.join(root, "sessions", name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "marker.txt"), "x");
  const past = new Date(Date.now() - ageHours * 3600_000);
  await utimes(dir, past, past);
  return dir;
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

async function purgeSessions(): Promise<void> {
  await rm(path.join(root, "sessions"), { recursive: true, force: true });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "claw-session-store-test-"));
  process.env["XYNE_CLAW_DATA_DIR"] = root;
  process.env["SESSION_ARCHIVE_RETRY_ATTEMPTS"] = "1";
  process.env["SESSION_ARCHIVE_RETRY_BACKOFF_MS"] = "0";
  process.env["SESSION_ARCHIVE_TIMEOUT_MS"] = "1000";
  store = await import("../src/session-store.js");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("cleanupSessions disposal guards", () => {
  it("never removes a TTL-expired dir while its session is active", async () => {
    const dir = await makeSessionDir("conv-active_k1", 48);
    store.markSessionActive("conv-active_k1");
    try {
      await store.cleanupSessions();
      expect(await exists(dir)).toBe(true);
    } finally {
      store.markSessionIdle("conv-active_k1");
      await purgeSessions();
    }
  });

  it("never removes the bare conversation spill dir of an active storeKey", async () => {
    const dir = await makeSessionDir("conv-bare", 48);
    store.markSessionActive("conv-bare_key7");
    try {
      await store.cleanupSessions();
      expect(await exists(dir)).toBe(true);
    } finally {
      store.markSessionIdle("conv-bare_key7");
      await purgeSessions();
    }
  });

  it("deletes .stale- rollback debris regardless of age, without archiving", async () => {
    const dir = await makeSessionDir("conv-x.stale-123", 0);
    try {
      await store.cleanupSessions();
      expect(await exists(dir)).toBe(false);
    } finally {
      await purgeSessions();
    }
  });

  it("leaves fresh idle sessions alone", async () => {
    const dir = await makeSessionDir("conv-fresh_k1", 1);
    try {
      await store.cleanupSessions();
      expect(await exists(dir)).toBe(true);
    } finally {
      await purgeSessions();
    }
  });

  it("keeps a TTL-expired idle dir on disk when archive fails", async () => {
    const dir = await makeSessionDir("conv-expired-idle_k1", 48);
    try {
      await store.cleanupSessions();
      expect(await exists(dir)).toBe(true);
    } finally {
      await purgeSessions();
    }
  });
});
