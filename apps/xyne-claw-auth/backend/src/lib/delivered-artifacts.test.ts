import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ingested: [] as Array<{ ctx: Record<string, unknown>; artifact: Record<string, unknown> }>,
  shareFails: false,
  warns: [] as unknown[],
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn((...args: unknown[]) => { state.warns.push(args); }),
  }),
}));

vi.mock("./conversation-artifact-signals.js", () => ({
  ingestDeliveredArtifact: vi.fn(async (ctx: Record<string, unknown>, artifact: Record<string, unknown>) => {
    state.ingested.push({ ctx, artifact });
  }),
}));

vi.mock("../routes/design-shares.js", () => ({
  upsertDesignShare: vi.fn(async () => {
    if (state.shareFails) throw new Error("share boom");
    return { id: "share-1", sharePath: "s/tok", linkChanged: false };
  }),
  designShareUrl: vi.fn((path: string) => `https://claw.local/${path}`),
}));

const { recordDeliveredArtifacts } = await import("./delivered-artifacts.js");

const BASE = {
  conversationId: "conv-1",
  userId: "user-1",
  orgId: "org-1",
  messageId: "msg-1",
};

const HTML = { id: "att-html", originalFilename: "landing.html", mimeType: "text/html" };
const PDF = { id: "att-pdf", originalFilename: "report.pdf", mimeType: "application/pdf" };

describe("recordDeliveredArtifacts", () => {
  beforeEach(() => {
    state.ingested = [];
    state.warns = [];
    state.shareFails = false;
  });

  it("publishes a design share and a DESIGN_HTML row for a /design html delivery", async () => {
    const result = await recordDeliveredArtifacts({ ...BASE, task: "/design a landing page", attachments: [HTML] });

    expect(result.designShareUrl).toBe("https://claw.local/s/tok");
    const design = state.ingested.find((row) => row.artifact["kind"] === "DESIGN_HTML");
    expect(design?.artifact).toMatchObject({
      refId: "share-1",
      title: "landing",
      latestVersionRef: "att-html",
      url: "https://claw.local/s/tok",
    });
    expect(design?.ctx).toMatchObject({ conversationId: "conv-1", userId: "user-1", orgId: "org-1", messageId: "msg-1" });
  });

  it("records a REVIEW_ROOM keyed by the delivered file, with no design share", async () => {
    const result = await recordDeliveredArtifacts({ ...BASE, task: "/review the local changes", attachments: [HTML] });

    expect(result.designShareUrl).toBeNull();
    const room = state.ingested.find((row) => row.artifact["kind"] === "REVIEW_ROOM");
    expect(room?.artifact).toMatchObject({ refId: "att-html", latestVersionRef: "att-html", title: "landing" });
    expect(state.ingested.some((row) => row.artifact["kind"] === "DESIGN_HTML")).toBe(false);
    expect(state.ingested.some((row) => row.artifact["kind"] === "FILE")).toBe(false);
  });

  it("leaves a separate room per run instead of replacing the previous one", async () => {
    await recordDeliveredArtifacts({ ...BASE, task: "/review pass one", attachments: [HTML] });
    await recordDeliveredArtifacts({
      ...BASE,
      task: "/review pass two",
      attachments: [{ ...HTML, id: "att-html-2" }],
    });

    const rooms = state.ingested.filter((row) => row.artifact["kind"] === "REVIEW_ROOM");
    expect(rooms.map((row) => row.artifact["refId"])).toEqual(["att-html", "att-html-2"]);
  });

  it("records a LESSON for a /learn html delivery, not a review room", async () => {
    await recordDeliveredArtifacts({ ...BASE, task: "/learn how ssrf works", attachments: [HTML] });

    const lesson = state.ingested.find((row) => row.artifact["kind"] === "LESSON");
    expect(lesson?.artifact).toMatchObject({ refId: "att-html", latestVersionRef: "att-html" });
    expect(state.ingested.some((row) => row.artifact["kind"] === "REVIEW_ROOM")).toBe(false);
    expect(state.ingested.some((row) => row.artifact["kind"] === "DESIGN_HTML")).toBe(false);
  });

  it("records FILE rows and no share for a plain delivery", async () => {
    const result = await recordDeliveredArtifacts({ ...BASE, task: "make me a report", attachments: [PDF] });

    expect(result.designShareUrl).toBeNull();
    expect(state.ingested).toHaveLength(1);
    expect(state.ingested[0]!.artifact).toMatchObject({ kind: "FILE", refId: "att-pdf", title: "report.pdf" });
  });

  it("records SPEC rows for a /spec task", async () => {
    await recordDeliveredArtifacts({ ...BASE, task: "/spec the billing flow", attachments: [PDF] });

    expect(state.ingested[0]!.artifact["kind"]).toBe("SPEC");
  });

  it("skips the share when the org is unknown", async () => {
    const result = await recordDeliveredArtifacts({ ...BASE, orgId: null, task: "/design something", attachments: [HTML] });

    expect(result.designShareUrl).toBeNull();
    expect(state.ingested.some((row) => row.artifact["kind"] === "DESIGN_HTML")).toBe(false);
  });

  it("never throws when the share upsert fails", async () => {
    state.shareFails = true;
    const result = await recordDeliveredArtifacts({ ...BASE, task: "/dashboard sales", attachments: [HTML] });

    expect(result.designShareUrl).toBeNull();
    expect(state.warns.length).toBeGreaterThan(0);
  });
});
