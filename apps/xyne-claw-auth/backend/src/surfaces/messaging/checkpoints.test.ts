import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const enqueueOutbound = vi.fn(async (..._args: unknown[]) => undefined);
const activeRun = vi.fn(async (..._args: unknown[]) => ({ sessionId: "sess-1", agentSlug: "xyne", startedAt: Date.now() - 100_000 }) as { sessionId: string; agentSlug: string; startedAt: number } | null);

vi.mock("../../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: async (k: string, v: string, ...rest: unknown[]) => {
        if (rest.includes("NX") && store.has(k)) return null;
        store.set(k, v);
        return "OK";
      },
      incr: async (k: string) => {
        const n = Number(store.get(k) ?? 0) + 1;
        store.set(k, String(n));
        return n;
      },
      expire: async () => 1,
    }),
  },
}));
vi.mock("./delivery.js", () => ({ enqueueOutbound }));
vi.mock("./commands.js", () => ({
  activeRun,
  describeElapsed: (since: number) => `${Math.round((Date.now() - since) / 60_000)} minutes`,
}));

const { maybeSendCheckpoint, stopCheckpoints, checkpointText, CHECKPOINT_MAX } = await import("./checkpoints.js");

const target = { channel: "whatsapp-cloud", connectedSurfaceId: "acc", accountKey: "k", chatId: "919", senderId: "919", isGroup: false } as never;

beforeEach(() => {
  store.clear();
  enqueueOutbound.mockClear();
  activeRun.mockResolvedValue({ sessionId: "sess-1", agentSlug: "xyne", startedAt: Date.now() - 100_000 });
});

describe("maybeSendCheckpoint", () => {
  it("sends one line with the current step once the run has gone past 45s", async () => {
    await expect(maybeSendCheckpoint("sess-1", target, "🔍 spaces-search: apollo")).resolves.toBe(true);
    expect(enqueueOutbound).toHaveBeenCalledWith("acc", { kind: "text", chatId: "919", text: "⏳ Still on it (2 minutes) — 🔍 spaces-search: apollo" });
  });

  it("stays quiet in the first 45 seconds", async () => {
    activeRun.mockResolvedValueOnce({ sessionId: "sess-1", agentSlug: "xyne", startedAt: Date.now() - 10_000 });
    await expect(maybeSendCheckpoint("sess-1", target, "step")).resolves.toBe(false);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("sends at most one per minute", async () => {
    await maybeSendCheckpoint("sess-1", target, "a");
    await expect(maybeSendCheckpoint("sess-1", target, "b")).resolves.toBe(false);
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
  });

  it("stops after the cap and once the answer is out", async () => {
    store.set("claw:channel:checkpoint:count:sess-1", String(CHECKPOINT_MAX));
    await expect(maybeSendCheckpoint("sess-1", target, "a")).resolves.toBe(false);
    store.clear();
    await stopCheckpoints("sess-1");
    await expect(maybeSendCheckpoint("sess-1", target, "a")).resolves.toBe(false);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("ignores progress from a run that is no longer the chat's current one", async () => {
    activeRun.mockResolvedValueOnce({ sessionId: "sess-2", agentSlug: "xyne", startedAt: 0 });
    await expect(maybeSendCheckpoint("sess-1", target, "a")).resolves.toBe(false);
  });
});

describe("checkpointText", () => {
  it("drops generic labels", () => {
    expect(checkpointText("Working on it...", Date.now() - 120_000)).toBe("⏳ Still working on it (2 minutes).");
  });
});
