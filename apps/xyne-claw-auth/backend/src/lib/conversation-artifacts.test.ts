import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  upserts: [] as Array<{ where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }>,
  fallbackOrgId: "org_from_user" as string | undefined,
}));

vi.mock("./users-jit.js", () => ({
  orgIdForSpacesUser: vi.fn(async () => state.fallbackOrgId),
}));

vi.mock("../db.js", () => ({
  prisma: {
    conversationArtifact: {
      upsert: vi.fn(async (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        state.upserts.push(args);
        return { id: "art_1", ...args.create };
      }),
    },
  },
}));

const { detectLinkProvider, normalizeExternalUrl, recordConversationArtifact, toOpenRef } = await import(
  "./conversation-artifacts.js"
);
const { ingestArtifactSignals, ingestSandboxPreviewSignals } = await import("./conversation-artifact-signals.js");

const CTX = { conversationId: "conv_1", userId: "user_1", orgId: "org_1", runId: "run_1" };

describe("normalizeExternalUrl", () => {
  it("lowercases scheme and host and strips the fragment", () => {
    expect(normalizeExternalUrl("HTTPS://Docs.Google.COM/document/d/abc#heading")).toBe(
      "https://docs.google.com/document/d/abc",
    );
  });

  it("strips utm_* and common tracking params but keeps the rest", () => {
    expect(normalizeExternalUrl("https://example.com/a?utm_source=x&gclid=y&id=7&fbclid=z")).toBe(
      "https://example.com/a?id=7",
    );
  });

  it("keeps the path and rejects anything that is not an http(s) URL", () => {
    expect(normalizeExternalUrl("https://notion.so/team/Page-123")).toBe("https://notion.so/team/Page-123");
    expect(normalizeExternalUrl("not a url")).toBeNull();
    expect(normalizeExternalUrl("")).toBeNull();
    expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeExternalUrl("ftp://example.com/a")).toBeNull();
  });
});

describe("toOpenRef", () => {
  const base = {
    id: "art_1",
    conversationId: "conv_1",
    messageId: null,
    runId: null,
    kind: "CANVAS",
    refService: "SPACES",
    refId: "cv_9",
    url: null,
    provider: null,
    latestVersionRef: null,
    title: "Design doc",
    status: "ACTIVE",
    pinned: false,
    createdByUserId: "user_1",
    orgId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  it("omits url and versionRef when they are absent", () => {
    expect(toOpenRef(base as never)).toEqual({ kind: "CANVAS", service: "SPACES", refId: "cv_9" });
  });

  it("includes url and versionRef when present", () => {
    expect(toOpenRef({ ...base, url: "https://x.example/a", latestVersionRef: "v_2" } as never)).toEqual({
      kind: "CANVAS",
      service: "SPACES",
      refId: "cv_9",
      url: "https://x.example/a",
      versionRef: "v_2",
    });
  });
});

describe("recordConversationArtifact caps", () => {
  beforeEach(() => {
    state.upserts = [];
  });

  const base = {
    conversationId: "conv_1",
    createdByUserId: "user_1",
    orgId: "org_1",
    refService: "EXTERNAL" as const,
    kind: "LINK" as const,
  };

  it("falls back to the user's org when the caller has none", async () => {
    state.fallbackOrgId = "org_from_user";
    await recordConversationArtifact({ ...base, orgId: null, refId: "https://example.com/a", title: "a" });
    expect(state.upserts[0]?.create["orgId"]).toBe("org_from_user");
  });

  it("skips the record when no org can be resolved", async () => {
    state.fallbackOrgId = undefined;
    const row = await recordConversationArtifact({
      ...base,
      orgId: null,
      refId: "https://example.com/b",
      title: "b",
    });
    expect(row).toBeNull();
    expect(state.upserts).toHaveLength(0);
    state.fallbackOrgId = "org_from_user";
  });

  it("truncates the title to 300 characters", async () => {
    await recordConversationArtifact({ ...base, refId: "https://a.example/x", title: "t".repeat(900) });
    expect((state.upserts[0]?.create["title"] as string).length).toBe(300);
  });

  it("skips a non-LINK row whose refId exceeds 1000 characters", async () => {
    await recordConversationArtifact({
      ...base,
      kind: "FILE",
      refService: "CLAW",
      refId: "f".repeat(1001),
      title: "big",
    });
    expect(state.upserts).toHaveLength(0);
  });

  it("hashes an over-long LINK refId and keeps the full url, capped at 4000", async () => {
    const longUrl = `https://docs.google.com/document/d/x?q=${"z".repeat(4200)}`;
    await recordConversationArtifact({ ...base, refId: longUrl, url: longUrl, title: "Long doc" });
    const created = state.upserts[0]?.create as Record<string, string>;
    expect(created["refId"]).toMatch(/^[a-f0-9]{64}$/);
    expect(created["url"]?.length).toBe(4000);
    expect(created["url"]).toBe(longUrl.slice(0, 4000));
  });

  it("does not send an updatedAt of its own on update", async () => {
    await recordConversationArtifact({ ...base, refId: "https://a.example/x", title: "t" });
    expect(state.upserts[0]?.update).not.toHaveProperty("updatedAt");
  });
});

describe("detectLinkProvider", () => {
  it.each([
    ["https://docs.google.com/document/d/1/edit", "google_docs"],
    ["https://docs.google.com/spreadsheets/d/1/edit", "google_sheets"],
    ["https://docs.google.com/presentation/d/1/edit", "google_slides"],
    ["https://drive.google.com/file/d/1/view", "google_drive"],
    ["https://pitch.com/v/deck-abc", "pitch"],
    ["https://www.figma.com/file/abc", "figma"],
    ["https://notion.so/Page-1", "notion"],
    ["https://github.com/org/repo/pull/3", "github"],
    ["https://acme.atlassian.net/browse/XY-1", "jira"],
    ["https://acme.atlassian.net/wiki/spaces/X", "confluence"],
    ["https://example.com/thing", "other"],
    ["nonsense", "other"],
  ])("maps %s to %s", (url, provider) => {
    expect(detectLinkProvider(url)).toBe(provider);
  });
});

describe("ingestArtifactSignals", () => {
  beforeEach(() => {
    state.upserts = [];
  });

  it("maps a canvas tool result to a CANVAS/SPACES row", async () => {
    await ingestArtifactSignals({
      ...CTX,
      toolName: "spaces-create-canvas",
      toolResult: { canvasId: "cv_9", title: "Design doc", versionId: "v_2" },
    });
    expect(state.upserts).toHaveLength(1);
    const [call] = state.upserts;
    expect(call?.create).toMatchObject({
      kind: "CANVAS",
      refService: "SPACES",
      refId: "cv_9",
      title: "Design doc",
      latestVersionRef: "v_2",
      conversationId: "conv_1",
      createdByUserId: "user_1",
    });
    expect(call?.update).toMatchObject({ status: "ACTIVE" });
  });

  it("parses a JSON-string tool result", async () => {
    await ingestArtifactSignals({
      ...CTX,
      toolName: "spaces-edit-canvas",
      toolResult: JSON.stringify({ data: { canvasId: "cv_10", title: "Edited" } }),
    });
    expect(state.upserts[0]?.create).toMatchObject({ kind: "CANVAS", refId: "cv_10", title: "Edited" });
  });

  it("parses the plain-text canvas tool output", async () => {
    await ingestArtifactSignals({
      ...CTX,
      toolName: "spaces-create-canvas",
      toolResult:
        "[clf-x#1] Canvas created successfully!\n\nTitle: Test Canvas\nURL: http://localhost:5173/cmty/chat/canvas/85d66ad4-706c-440d-bd3f-4282873fd2d3\nVisibility: PRIVATE\nView Access ID: undefined",
    });
    expect(state.upserts[0]?.create).toMatchObject({
      kind: "CANVAS",
      refService: "SPACES",
      refId: "85d66ad4-706c-440d-bd3f-4282873fd2d3",
      title: "Test Canvas",
    });
  });

  it("parses MCP content parts for a connector tool", async () => {
    await ingestArtifactSignals({
      ...CTX,
      toolName: "google-docs-create",
      toolResult: { content: [{ type: "text", text: "Created document.\nTitle: Plan\nURL: https://docs.google.com/document/d/abc/edit" }] },
    });
    expect(state.upserts[0]?.create).toMatchObject({ kind: "LINK", provider: "google_docs", title: "Plan" });
  });

  it("maps an allowlisted connector tool with a URL to a LINK/EXTERNAL row", async () => {
    await ingestArtifactSignals({
      ...CTX,
      toolName: "google-docs-create",
      toolResult: { url: "https://docs.google.com/document/d/xyz/edit?utm_source=agent", title: "Q3 plan" },
    });
    expect(state.upserts[0]?.create).toMatchObject({
      kind: "LINK",
      refService: "EXTERNAL",
      refId: "https://docs.google.com/document/d/xyz/edit",
      url: "https://docs.google.com/document/d/xyz/edit?utm_source=agent",
      provider: "google_docs",
      title: "Q3 plan",
    });
  });

  it("normalizes the refId, keeps the raw url and derives the provider from the normalized url", async () => {
    await ingestArtifactSignals({
      ...CTX,
      toolName: "create_page",
      toolResult: { url: "HTTPS://Acme.NOTION.so/Plan-1?utm_campaign=x&v=2#top", title: "Plan" },
    });
    expect(state.upserts[0]?.create).toMatchObject({
      kind: "LINK",
      refService: "EXTERNAL",
      refId: "https://acme.notion.so/Plan-1?v=2",
      url: "HTTPS://Acme.NOTION.so/Plan-1?utm_campaign=x&v=2#top",
      provider: "notion",
    });
    expect(state.upserts[0]?.where).toEqual({
      conversationId_kind_refId: { conversationId: "conv_1", kind: "LINK", refId: "https://acme.notion.so/Plan-1?v=2" },
    });
    expect(state.upserts[0]?.update).toMatchObject({ status: "ACTIVE", provider: "notion" });
  });

  it("falls back to the normalized url as the title when the result has none", async () => {
    await ingestArtifactSignals({
      ...CTX,
      toolName: "create_pull_request",
      toolResult: { html_url: "https://github.com/org/repo/pull/3" },
    });
    expect(state.upserts[0]?.create).toMatchObject({
      provider: "github",
      title: "https://github.com/org/repo/pull/3",
    });
  });

  it("skips a LINK whose host is not in the provider allowlist", async () => {
    await ingestArtifactSignals({
      ...CTX,
      toolName: "create_page",
      toolResult: { url: "https://evil.example/exfil", title: "Plan" },
    });
    expect(state.upserts).toHaveLength(0);
  });

  it("skips a LINK whose url is not http(s)", async () => {
    await ingestArtifactSignals({
      ...CTX,
      toolName: "create_page",
      toolResult: { url: "javascript:alert(1)", title: "Plan" },
    });
    expect(state.upserts).toHaveLength(0);
  });

  it("ignores read-only tools, unknown tools and results without a URL", async () => {
    await ingestArtifactSignals({ ...CTX, toolName: "google-docs-read", toolResult: { url: "https://docs.google.com/document/d/x" } });
    await ingestArtifactSignals({ ...CTX, toolName: "google-drive-search", toolResult: { url: "https://drive.google.com/x" } });
    await ingestArtifactSignals({ ...CTX, toolName: "google-docs-create", toolResult: { ok: true } });
    await ingestArtifactSignals({ ...CTX, toolName: "spaces-create-canvas", toolResult: "plain text" });
    expect(state.upserts).toHaveLength(0);
  });

  it("never throws on a hostile result", async () => {
    await expect(
      ingestArtifactSignals({ ...CTX, toolName: "spaces-create-canvas", toolResult: null }),
    ).resolves.toBeUndefined();
  });

  it("maps sandbox preview payloads to DIFF and PREVIEW rows", async () => {
    await ingestSandboxPreviewSignals(CTX, {
      sandboxId: "sbx_3",
      sandboxPreviewUrl: "https://p.example/claw-preview/sbx_3/",
      sandboxCodePreviewUrl: "https://p.example/claw-code/sbx_3",
    });
    expect(state.upserts.map((u) => u.create["kind"])).toEqual(["DIFF", "PREVIEW"]);
    expect(state.upserts[0]?.create).toMatchObject({
      refService: "CLAW",
      refId: "sbx_3",
      url: "https://p.example/claw-code/sbx_3",
      latestVersionRef: "run_1",
    });
  });

  it("skips sandbox previews with no sandbox id", async () => {
    await ingestSandboxPreviewSignals(CTX, { sandboxPreviewUrl: "https://p.example/x" });
    expect(state.upserts).toHaveLength(0);
  });
});
