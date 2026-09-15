import { describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../config.js", () => ({
  CONFIG: {
    xyneClawUrl: "http://claw.local",
    xyneClawS2sKey: "s2s",
    internalUrl: "http://auth.local",
    clawSseTransport: false,
    encryptionKey: Buffer.alloc(32, 7),
    defaultAgentSlug: "assistant",
  },
}));

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));
vi.mock("xyne-claw-shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}));

const { startRun } = await import("./start-run.js");

describe("startRun validation failures", () => {
  const input = (body: Record<string, unknown>) => ({
    body,
    isInternalRun: true,
    isInternalS2SCaller: true,
    wantsSse: false,
  });

  it("returns ok:false with today's 400 for a missing task instead of throwing", async () => {
    const result = await startRun(input({ userId: "u1" }), {});

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "task is required and must be a non-empty string",
    });
  });

  it("returns ok:false with today's 400 for a blank task", async () => {
    const result = await startRun(input({ userId: "u1", task: "   " }), {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toBe("task is required and must be a non-empty string");
  });

  it("returns ok:false with today's 400 for a non-string callbackUrl", async () => {
    const result = await startRun(input({ userId: "u1", task: "hi", callbackUrl: 7 }), {});

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "callbackUrl must be a string",
    });
  });

  it("returns ok:false with today's 400 for a malformed recordingRefs field", async () => {
    const result = await startRun(
      input({ userId: "u1", task: "hi", recordingRefs: "not-an-array" }),
      {},
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error:
        "recordingRefs must contain at most four valid video references, each no larger than 1 GB",
    });
  });

  it("returns ok:false with today's 403 when a service token lacks runs:write", async () => {
    const result = await startRun(input({ userId: "u1", task: "hi" }), {
      serviceToken: {
        client: "service",
        scopes: ["agent:assistant"],
      } as never,
    });

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "This token does not have the runs:write scope",
    });
  });
});
