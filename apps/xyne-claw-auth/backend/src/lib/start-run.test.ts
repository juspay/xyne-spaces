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

const { startRun, withServerOwnedDesignSystemRef } = await import("./start-run.js");

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

/**
 * XYNE-66827. The design system ref decides the CSS branded into downloaded
 * PDFs and inlined into email drafts sent from the user's own mailbox, so where
 * it comes from is a security property, not a detail.
 *
 * Delete this block with the function when XYNE-66821 lands.
 */
describe("withServerOwnedDesignSystemRef", () => {
  const resolved = {
    id: "ds-trusted",
    name: "Trusted",
    designMd: "# Trusted",
    tokensCss: ":root{--brand-primary:#0B5FFF}",
    origin: "conversation" as const,
  };
  const spoofed = {
    id: "ds-attacker",
    name: "Attacker",
    designMd: "# Attacker",
    tokensCss: ":root{--brand-primary:#FF0000}",
    origin: "agent" as const,
  };

  it("replaces a caller-supplied ref with the resolved one", () => {
    const out = withServerOwnedDesignSystemRef(
      { designSystemRef: spoofed, other: "kept" },
      resolved,
    );
    expect(out["designSystemRef"]).toEqual(resolved);
    expect(out["other"]).toBe("kept");
  });

  it("drops a caller-supplied ref entirely when nothing resolves", () => {
    // The hole this closes: the ref was only ever SET on a hit, so with no
    // stored system a spoofed ref survived into the tool context and branded
    // the run.
    const out = withServerOwnedDesignSystemRef({ designSystemRef: spoofed }, null);
    expect(out).not.toHaveProperty("designSystemRef");
  });

  it("carries the resolved ref when the caller supplied none", () => {
    expect(
      withServerOwnedDesignSystemRef({}, resolved)["designSystemRef"],
    ).toEqual(resolved);
  });

  it("sets no key at all when there is no system and no spoof", () => {
    expect(withServerOwnedDesignSystemRef({ a: 1 }, null)).toEqual({ a: 1 });
  });

  it("copies only the five ref fields, so nothing else rides along", () => {
    const out = withServerOwnedDesignSystemRef({}, {
      ...resolved,
      // A field a future ResolvedDesignSystem might carry but the wire shape
      // must not.
      secret: "do not forward",
    } as unknown as typeof resolved);
    expect(Object.keys(out["designSystemRef"] as object).sort()).toEqual([
      "designMd",
      "id",
      "name",
      "origin",
      "tokensCss",
    ]);
  });
});
