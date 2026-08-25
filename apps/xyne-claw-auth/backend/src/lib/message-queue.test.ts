import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above imports, so any variables its factory references must
// be created with vi.hoisted (also hoisted) — otherwise they're in the TDZ when
// the factory runs. getMock stands in for redis.get(busyKey); getConnMock for
// redisService.getConnection().
const { getMock, getConnMock, delMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  getConnMock: vi.fn(),
  delMock: vi.fn(),
}));

vi.mock("../redis.js", () => ({
  redisService: { getConnection: getConnMock },
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { isSlotBusy, releaseSlot, tryAcquireSlot, getSlotOwner, attachSlotSession } from "./message-queue.js";

describe("releaseSlot key scoping (twin-slot leak regression, 2026-08-19)", () => {
  beforeEach(() => {
    delMock.mockReset();
    getConnMock.mockReset();
    getConnMock.mockReturnValue({ del: delMock });
  });

  it("releases the 3-part per-user key for a digital-twin run WHEN the scope is passed", async () => {
    await releaseSlot("conv-1", "digital-twin", undefined, "user-9");
    expect(delMock).toHaveBeenCalledWith("claw:busy:conv-1:digital-twin:user-9");
  });

  it("releases the WRONG (2-part) key for a twin run when the scope is omitted — the bug", async () => {
    // This is exactly what webhook.ts:4817 did before the fix: releasing a twin
    // slot without resultUserScope targets the 2-part key, misses the real
    // 3-part marker, and leaks the slot for the full BUSY_TTL (20m). The run
    // handler MUST pass the twin scope; this pins that the omission mis-keys.
    await releaseSlot("conv-1", "digital-twin");
    expect(delMock).toHaveBeenCalledWith("claw:busy:conv-1:digital-twin");
    expect(delMock).not.toHaveBeenCalledWith("claw:busy:conv-1:digital-twin:user-9");
  });

  it("stays 2-part (unscoped) for a non-twin agent regardless of scope arg", async () => {
    await releaseSlot("conv-1", "ask-ai", undefined, "user-9");
    expect(delMock).toHaveBeenCalledWith("claw:busy:conv-1:ask-ai");
  });
});

describe("isSlotBusy", () => {
  beforeEach(() => {
    getMock.mockReset();
    getConnMock.mockReset();
    getConnMock.mockReturnValue({ get: getMock });
  });

  it("returns true when a busy marker is present (a run is active)", async () => {
    getMock.mockResolvedValue("pod-1730000000-abc123"); // a live slot token
    await expect(isSlotBusy("conv-1", "ask-ai")).resolves.toBe(true);
    expect(getMock).toHaveBeenCalledWith("claw:busy:conv-1:ask-ai");
  });

  it("returns false when no marker is present (idle conversation)", async () => {
    getMock.mockResolvedValue(null);
    await expect(isSlotBusy("conv-1", "ask-ai")).resolves.toBe(false);
  });

  it("fails OPEN (returns false) on a Redis error so an outage can't block all approvals", async () => {
    getConnMock.mockImplementation(() => {
      throw new Error("redis unreachable");
    });
    await expect(isSlotBusy("conv-1", "ask-ai")).resolves.toBe(false);
  });

  it("returns false (and never touches Redis) when ids are missing", async () => {
    await expect(isSlotBusy("", "ask-ai")).resolves.toBe(false);
    await expect(isSlotBusy("conv-1", "")).resolves.toBe(false);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("uses a per-user busy key for the digital-twin agent", async () => {
    getMock.mockResolvedValue("token");
    await isSlotBusy("conv-1", "digital-twin", "user-9");
    expect(getMock).toHaveBeenCalledWith("claw:busy:conv-1:digital-twin:user-9");
  });
});

describe("slot owner metadata (same-user interrupt source of truth)", () => {
  let setLocal: ReturnType<typeof vi.fn>;
  let getLocal: ReturnType<typeof vi.fn>;
  let pexpireLocal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getConnMock.mockReset();
    setLocal = vi.fn().mockResolvedValue("OK");
    getLocal = vi.fn();
    pexpireLocal = vi.fn().mockResolvedValue(1);
    getConnMock.mockReturnValue({ set: setLocal, get: getLocal, pexpire: pexpireLocal });
  });

  it("tryAcquireSlot stamps the owner userId on the meta key when the slot is won", async () => {
    setLocal.mockResolvedValueOnce("OK");
    const token = await tryAcquireSlot("conv-1", "ask-ai", undefined, "user-7");
    expect(token).toBeTruthy();
    expect(setLocal).toHaveBeenCalledWith("claw:busy:conv-1:ask-ai", expect.any(String), "PX", expect.any(Number), "NX");
    expect(setLocal).toHaveBeenCalledWith("claw:busymeta:conv-1:ask-ai", JSON.stringify({ userId: "user-7" }), "PX", expect.any(Number));
  });

  it("tryAcquireSlot writes no meta when the slot is already held", async () => {
    setLocal.mockResolvedValueOnce(null);
    const token = await tryAcquireSlot("conv-1", "ask-ai", undefined, "user-7");
    expect(token).toBeNull();
    expect(setLocal).toHaveBeenCalledTimes(1);
  });

  it("tryAcquireSlot writes no meta when no ownerUserId is given (back-compat)", async () => {
    setLocal.mockResolvedValueOnce("OK");
    await tryAcquireSlot("conv-1", "ask-ai");
    expect(setLocal).toHaveBeenCalledTimes(1);
  });

  it("getSlotOwner returns the parsed {userId, sessionId}", async () => {
    getLocal.mockResolvedValue(JSON.stringify({ userId: "u1", sessionId: "s1" }));
    await expect(getSlotOwner("conv-1", "ask-ai")).resolves.toEqual({ userId: "u1", sessionId: "s1" });
    expect(getLocal).toHaveBeenCalledWith("claw:busymeta:conv-1:ask-ai");
  });

  it("getSlotOwner returns null when no meta is present", async () => {
    getLocal.mockResolvedValue(null);
    await expect(getSlotOwner("conv-1", "ask-ai")).resolves.toBeNull();
  });

  it("getSlotOwner fails safe to null on a Redis error", async () => {
    getConnMock.mockImplementation(() => { throw new Error("down"); });
    await expect(getSlotOwner("conv-1", "ask-ai")).resolves.toBeNull();
  });

  it("attachSlotSession merges the sessionId while preserving the ownerUserId", async () => {
    getLocal.mockResolvedValue(JSON.stringify({ userId: "u1" }));
    await attachSlotSession("conv-1", "ask-ai", "sess-9");
    expect(setLocal).toHaveBeenCalledWith("claw:busymeta:conv-1:ask-ai", JSON.stringify({ userId: "u1", sessionId: "sess-9" }), "PX", expect.any(Number));
  });

  it("attachSlotSession only refreshes TTL when the sessionId is already stamped", async () => {
    getLocal.mockResolvedValue(JSON.stringify({ userId: "u1", sessionId: "sess-9" }));
    await attachSlotSession("conv-1", "ask-ai", "sess-9");
    expect(setLocal).not.toHaveBeenCalled();
    expect(pexpireLocal).toHaveBeenCalledWith("claw:busymeta:conv-1:ask-ai", expect.any(Number));
  });
});
