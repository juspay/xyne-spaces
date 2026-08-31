import { describe, expect, it, vi, beforeEach } from "vitest";

const interactMock = vi.hoisted(() => vi.fn());
vi.mock("../mcp/servers/xyne-spaces-client.js", () => ({ interact: interactMock }));

const { boundedInteract, pageBounded, UnboundedQueryError, SPACES_MAX_TAKE } = await import("./spaces-read.js");

const auth = { token: "t", workspaceId: "ws" };

beforeEach(() => interactMock.mockReset());

/**
 * Guards the verified gap in the Spaces query validator: `take` is capped only
 * when SUPPLIED, so an omitted take is an unbounded findMany on a hot table.
 */
describe("boundedInteract", () => {
  it("refuses a findMany with no take", async () => {
    await expect(boundedInteract({ model: "message", operation: "findMany" }, auth)).rejects.toThrow(
      UnboundedQueryError,
    );
    expect(interactMock).not.toHaveBeenCalled();
  });

  it("refuses a zero or negative take", async () => {
    await expect(boundedInteract({ model: "message", operation: "findMany", take: 0 }, auth)).rejects.toThrow();
    await expect(boundedInteract({ model: "message", operation: "findMany", take: -1 }, auth)).rejects.toThrow();
    await expect(
      boundedInteract({ model: "message", operation: "findMany", take: NaN }, auth),
    ).rejects.toThrow();
  });

  it("allows a count with no take — it returns a scalar, not rows", async () => {
    interactMock.mockResolvedValue(7);
    await expect(boundedInteract({ model: "message", operation: "count" }, auth)).resolves.toBe(7);
  });

  it("clamps a take above MAX_TAKE instead of letting Spaces reject it", async () => {
    interactMock.mockResolvedValue([]);
    await boundedInteract({ model: "message", operation: "findMany", take: 99_999 }, auth);
    expect(interactMock.mock.calls[0]![0].take).toBe(SPACES_MAX_TAKE);
  });

  it("passes a valid query through untouched", async () => {
    interactMock.mockResolvedValue([{ id: 1 }]);
    const out = await boundedInteract({ model: "message", operation: "findMany", take: 10 }, auth);
    expect(out).toEqual([{ id: 1 }]);
  });
});

describe("pageBounded", () => {
  it("stops on a short page", async () => {
    interactMock.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    const out = await pageBounded<{ id: string }>(
      { model: "message", operation: "findMany" },
      auth,
      100,
      10,
      (last) => ({ id: { gt: last.id } }),
    );
    expect(out).toHaveLength(2);
    expect(interactMock).toHaveBeenCalledTimes(1);
  });

  it("pages until the limit and never exceeds it", async () => {
    interactMock
      .mockResolvedValueOnce([{ id: "a" }, { id: "b" }])
      .mockResolvedValueOnce([{ id: "c" }, { id: "d" }])
      .mockResolvedValueOnce([{ id: "e" }]);
    const out = await pageBounded<{ id: string }>(
      { model: "message", operation: "findMany" },
      auth,
      5,
      2,
      (last) => ({ id: { gt: last.id } }),
    );
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("advances the keyset cursor from the last row of each page", async () => {
    interactMock
      .mockResolvedValueOnce([{ id: "a" }, { id: "b" }])
      .mockResolvedValueOnce([{ id: "c" }]);
    await pageBounded<{ id: string }>(
      { model: "message", operation: "findMany", where: { x: 1 } },
      auth,
      10,
      2,
      (last) => ({ id: { gt: last.id } }),
    );
    expect(interactMock.mock.calls[1]![0].where).toEqual({ AND: [{ x: 1 }, { id: { gt: "b" } }] });
  });

  it("stops when advance returns null", async () => {
    interactMock.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    const out = await pageBounded<{ id: string }>(
      { model: "message", operation: "findMany" },
      auth,
      10,
      2,
      () => null,
    );
    expect(out).toHaveLength(2);
    expect(interactMock).toHaveBeenCalledTimes(1);
  });

  it("handles an empty first page", async () => {
    interactMock.mockResolvedValueOnce([]);
    const out = await pageBounded({ model: "message", operation: "findMany" }, auth, 10, 5, () => null);
    expect(out).toEqual([]);
  });
});
