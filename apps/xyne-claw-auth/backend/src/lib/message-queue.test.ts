import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above imports, so any variables its factory references must
// be created with vi.hoisted (also hoisted) — otherwise they're in the TDZ when
// the factory runs. getMock stands in for redis.get(busyKey); getConnMock for
// redisService.getConnection().
const { getMock, getConnMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  getConnMock: vi.fn(),
}));

vi.mock("../redis.js", () => ({
  redisService: { getConnection: getConnMock },
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { isSlotBusy } from "./message-queue.js";

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
