import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RUN_CONTROL_MAX_AGE_MS,
  decideRunControl,
  handleRunControlMessage,
  isFreshRunControlMessage,
  parseRunControlMessage,
  registerRunControlApplier,
  type RunControlMessage,
  type RunControlRequest,
} from "../src/run-control.js";

function msg(overrides: Partial<RunControlMessage> = {}): RunControlMessage {
  return {
    type: "cancel",
    sessionId: "sess-1",
    userId: "user-1",
    issuedAt: Date.now(),
    origin: "pod-a",
    ...overrides,
  };
}

describe("parseRunControlMessage", () => {
  beforeEach(() => {
    registerRunControlApplier(null);
  });

  it("parses a well-formed cancel", () => {
    const parsed = parseRunControlMessage(JSON.stringify(msg()));
    expect(parsed?.type).toBe("cancel");
    expect(parsed?.sessionId).toBe("sess-1");
    expect(parsed?.userId).toBe("user-1");
    expect(parsed?.origin).toBe("pod-a");
  });

  it("keeps requestedBy on an interrupt", () => {
    const parsed = parseRunControlMessage(
      JSON.stringify(msg({ type: "interrupt", requestedBy: "user-2" })),
    );
    expect(parsed?.type).toBe("interrupt");
    expect(parsed?.requestedBy).toBe("user-2");
  });

  it("rejects bad JSON", () => {
    expect(parseRunControlMessage("{not json")).toBeNull();
    expect(parseRunControlMessage("[]")).toBeNull();
    expect(parseRunControlMessage("null")).toBeNull();
  });

  it("rejects unknown types and missing fields", () => {
    expect(parseRunControlMessage(JSON.stringify(msg({ type: "boom" as never })))).toBeNull();
    expect(parseRunControlMessage(JSON.stringify(msg({ sessionId: "" })))).toBeNull();
    expect(parseRunControlMessage(JSON.stringify(msg({ origin: "" })))).toBeNull();
    expect(parseRunControlMessage(JSON.stringify(msg({ issuedAt: "now" as never })))).toBeNull();
  });

  it("treats messages older than the max age as stale", () => {
    const now = Date.now();
    expect(isFreshRunControlMessage(msg({ issuedAt: now - 1_000 }), now)).toBe(true);
    expect(isFreshRunControlMessage(msg({ issuedAt: now - RUN_CONTROL_MAX_AGE_MS - 1 }), now)).toBe(false);
  });
});

describe("handleRunControlMessage", () => {
  it("applies when the session is local", () => {
    const activeRuns = new Map<string, { userId: string }>([["sess-1", { userId: "user-1" }]]);
    const apply = vi.fn((m: RunControlMessage) => activeRuns.has(m.sessionId));
    expect(handleRunControlMessage(JSON.stringify(msg()), { apply })).toBe("applied");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("ignores a session this pod does not hold", () => {
    const activeRuns = new Map<string, { userId: string }>();
    const apply = vi.fn((m: RunControlMessage) => activeRuns.has(m.sessionId));
    expect(handleRunControlMessage(JSON.stringify(msg()), { apply })).toBe("not_local");
  });

  it("never applies an unparseable or stale message", () => {
    const apply = vi.fn(() => true);
    expect(handleRunControlMessage("nope", { apply })).toBe("invalid");
    const now = Date.now();
    expect(
      handleRunControlMessage(JSON.stringify(msg({ issuedAt: now - RUN_CONTROL_MAX_AGE_MS - 5 })), {
        apply,
        now,
      }),
    ).toBe("stale");
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("decideRunControl", () => {
  it("forwards when another pod owns the session", async () => {
    const published: RunControlRequest[] = [];
    const decision = await decideRunControl(
      { type: "cancel", sessionId: "sess-1", userId: "user-1" },
      {
        currentOwnerPod: async () => "pod-b",
        publish: async (req) => {
          published.push(req);
          return true;
        },
      },
    );
    expect(decision).toEqual({ action: "forwarded", ownerPod: "pod-b" });
    expect(published).toHaveLength(1);
    expect(published[0]?.userId).toBe("user-1");
  });

  it("answers not_running when no pod owns the session", async () => {
    const publish = vi.fn(async () => true);
    const decision = await decideRunControl(
      { type: "cancel", sessionId: "sess-1" },
      { currentOwnerPod: async () => null, publish },
    );
    expect(decision).toEqual({ action: "not_running" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("falls back to not_running when publish or lookup fails", async () => {
    const failedPublish = await decideRunControl(
      { type: "interrupt", sessionId: "sess-1", requestedBy: "user-1" },
      { currentOwnerPod: async () => "pod-b", publish: async () => false },
    );
    expect(failedPublish).toEqual({ action: "not_running" });

    const failedLookup = await decideRunControl(
      { type: "cancel", sessionId: "sess-1" },
      {
        currentOwnerPod: async () => {
          throw new Error("redis down");
        },
        publish: async () => true,
      },
    );
    expect(failedLookup).toEqual({ action: "not_running" });
  });
});
