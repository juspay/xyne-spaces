import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSdlcAgentToolProfile,
  SDLC_GENERIC_SANDBOX_TOOLS,
  SDLC_PLANNING_TOOLS,
  SDLC_SUBAGENTS,
} from "xyne-claw-shared";

const mocks = vi.hoisted(() => ({
  interact: vi.fn(),
  spacesFetchBuffer: vi.fn(),
  spacesFetch: vi.fn(),
  spacesFetchText: vi.fn(),
  search: vi.fn(),
  memorySearch: vi.fn(),
  appFetch: vi.fn(),
}));

vi.mock("./xyne-spaces-client.js", () => mocks);

process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);
process.env["XYNE_CLAW_URL"] = "http://claw.local";
process.env["XYNE_CLAW_S2S_KEY"] = "s2s-secret";

async function fetchAttachmentTool() {
  const mod = await import("./xyne-spaces-tools.js");
  const tool = mod.tools.find((t) => t.name === "spaces-fetch-attachment");
  if (!tool) throw new Error("spaces-fetch-attachment tool not found");
  return tool;
}

async function artifactMutationTool() {
  const mod = await import("./xyne-spaces-tools.js");
  const tool = mod.tools.find((t) => t.name === "spaces-sdlc-mutate-artifact");
  if (!tool) throw new Error("spaces-sdlc-mutate-artifact tool not found");
  return tool;
}

async function artifactHistoryTool(name: "spaces-sdlc-list-artifact-versions" | "spaces-sdlc-read-artifact-version") {
  const mod = await import("./xyne-spaces-tools.js");
  const tool = mod.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`${name} tool not found`);
  return tool;
}

async function currentArtifactTool(name: "spaces-sdlc-list-artifacts" | "spaces-sdlc-read-artifact") {
  const mod = await import("./xyne-spaces-tools.js");
  const tool = mod.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`${name} tool not found`);
  return tool;
}

describe("spaces-sdlc-mutate-artifact schema", () => {
  it("declares canonical artifact types and actions", async () => {
    const tool = await artifactMutationTool();
    const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;

    expect(properties["artifactType"]?.enum).toEqual(["WIKI", "BASELINE", "PRD", "TECH_DOC"]);
    expect(properties["action"]?.enum).toEqual(expect.arrayContaining([
      "create", "update", "move", "archive", "restore", "begin", "upsert_section", "finalize",
    ]));
    expect(tool.inputSchema.required).toEqual(["artifactType", "action"]);
  });

  it("does not export retired artifact aliases", async () => {
    const mod = await import("./xyne-spaces-tools.js");
    const names = mod.tools.map((tool) => tool.name);
    expect(names).not.toEqual(expect.arrayContaining([
      "spaces-sdlc-create-artifact",
      "spaces-sdlc-update-baseline",
      "spaces-sdlc-wiki-list-pages",
      "spaces-sdlc-wiki-read-page",
      "spaces-sdlc-wiki-write-page",
      "spaces-sdlc-wiki-move-page",
    ]));
  });
});

describe("canonical SDLC agent tool profile", () => {
  it("includes every live Spaces tool and canonical custom/subagent tools", async () => {
    const mod = await import("./xyne-spaces-tools.js");
    const exportedNames = mod.tools.map((tool) => tool.name);
    const profile = buildSdlcAgentToolProfile(exportedNames);

    expect(profile.tools.direct).toEqual(exportedNames);
    expect(profile.tools.custom).toEqual([
      ...SDLC_GENERIC_SANDBOX_TOOLS,
      "sandbox-sdlc-git-context",
      ...SDLC_PLANNING_TOOLS,
    ]);
    expect(profile.tools.subagents).toEqual([...SDLC_SUBAGENTS]);
    expect([41, 46]).toContain(profile.tools.direct.length);
    expect(
      profile.tools.direct.length + profile.tools.custom.length + profile.tools.subagents.length,
    ).toBe(profile.tools.direct.length === 46 ? 66 : 61);
    expect(profile.tools.custom).not.toEqual(expect.arrayContaining([
      "builtin__read", "builtin__write", "builtin__grep", "builtin__find", "builtin__ls",
    ]));
  });
});

describe("SDLC artifact history tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declare a typed Wiki-page or SDLC-Canvas selector", async () => {
    const list = await artifactHistoryTool("spaces-sdlc-list-artifact-versions");
    const read = await artifactHistoryTool("spaces-sdlc-read-artifact-version");
    const selector = (list.inputSchema.properties as Record<string, Record<string, unknown>>)["selector"];
    const variants = selector?.["oneOf"] as Array<{
      properties: Record<string, { const?: string }>;
      required: string[];
    }>;

    expect(variants.map(variant => variant.properties["type"]?.const)).toEqual([
      "WIKI_PAGE",
      "SDLC_CANVAS",
    ]);
    expect(variants.map(variant => variant.required)).toEqual([
      ["type", "path"],
      ["type", "canvasId"],
    ]);
    expect(read.inputSchema.required).toContain("versionId");
  });

  it("passes acting-user identity out of band to the internal history route", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, versions: [] });
    const list = await artifactHistoryTool("spaces-sdlc-list-artifact-versions");

    await list.handler({
      repoId: "repo-1",
      workspaceId: "workspace-1",
      actorUserId: "user-1",
      selector: { type: "WIKI_PAGE", path: "overview.md" },
    }, { userId: "user-1" } as never);

    expect(mocks.spacesFetch).toHaveBeenCalledWith(
      "/api/internal/sdlc/artifact-versions/list",
      expect.objectContaining({
        method: "POST",
        headers: { "x-xyne-acting-user-id": "user-1" },
      }),
      { s2sKey: expect.any(String) },
    );
  });
});

describe("canonical current artifact tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves server-authored Wiki assignment state for supervised Wiki runs", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ success: true, assignment: {} });
    const list = await currentArtifactTool("spaces-sdlc-list-artifacts");

    await list.handler({
      repoId: "repo-1",
      workspaceId: "workspace-1",
      actorUserId: "user-1",
      executionId: "execution-1",
      sessionId: "session-1",
    }, { userId: "user-1" } as never);

    expect(mocks.spacesFetch).toHaveBeenCalledWith(
      "/api/internal/sdlc/wiki/pages/list",
      expect.objectContaining({ method: "POST" }),
      { s2sKey: expect.any(String) },
    );
  });
});

function mockMeta(overrides: Partial<{
  id: string;
  originalFilename: string;
  mimetype: string;
  size: number;
}> = {}) {
  mocks.interact.mockResolvedValueOnce([{
    id: overrides.id ?? "att-1",
    originalFilename: overrides.originalFilename ?? "Lotuspay Webappsec final report.pdf",
    mimetype: overrides.mimetype ?? "application/pdf",
    size: overrides.size ?? 11 * 1024 * 1024,
    createdAt: "2026-08-06T10:00:00.000Z",
    uploadedByUserId: "user-1",
    entityId: "msg-1",
  }]);
}

describe("spaces-fetch-attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("converts a large PDF to markdown instead of returning base64 through MCP", async () => {
    mockMeta();
    mocks.spacesFetch.mockResolvedValueOnce({
      url: "https://storage.local/signed-report-url",
      filename: "Lotuspay Webappsec final report.pdf",
      mimeType: "application/pdf",
      size: 11 * 1024 * 1024,
      expiresInMinutes: 10,
    });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        files: [{
          path: "Lotuspay Webappsec final report.pdf.md",
          content: "# Extracted report\n\nFindings summary",
        }],
      }),
    } as Response);

    const tool = await fetchAttachmentTool();
    const result = await tool.handler({ attachmentId: "att-1" }, { userId: "u1", authMode: "user" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("extracted it to markdown");
    expect(text).toContain("Findings summary");
    expect(text).not.toContain("[SPACES_ATTACHMENT:");
    expect(mocks.spacesFetchBuffer).not.toHaveBeenCalled();
    expect(mocks.spacesFetch).toHaveBeenCalledWith("/api/attachments/att-1/signed-url");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://claw.local/internal/attachments/ingest",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-s2s-key": "s2s-secret" }),
        body: JSON.stringify({
          attachments: [{
            fileName: "Lotuspay Webappsec final report.pdf",
            mimeType: "application/pdf",
            url: "https://storage.local/signed-report-url",
            size: 11 * 1024 * 1024,
          }],
        }),
      }),
    );
  });

  it("returns the Spaces permission-denied error when signed URL ACL blocks access", async () => {
    mockMeta();
    mocks.spacesFetch.mockRejectedValueOnce(new Error("Spaces API 403: Forbidden"));

    const tool = await fetchAttachmentTool();
    const result = await tool.handler({ attachmentId: "att-1" }, { userId: "u1", authMode: "user" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBe(true);
    expect(text).toContain("Could not get a short-lived download link");
    expect(text).toContain("Lotuspay Webappsec final report.pdf");
    expect(text).toContain("Spaces API 403");
    expect(text).toContain("same attachment permissions as the normal Spaces download");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns an actionable oversize error for unsupported large files", async () => {
    mockMeta({
      originalFilename: "packet-capture.bin",
      mimetype: "application/octet-stream",
      size: 8 * 1024 * 1024,
    });
    mocks.spacesFetch.mockResolvedValueOnce({
      url: "https://storage.local/signed-bin-url",
      filename: "packet-capture.bin",
      mimeType: "application/octet-stream",
      size: 8 * 1024 * 1024,
      expiresInMinutes: 10,
    });

    const tool = await fetchAttachmentTool();
    const result = await tool.handler({ attachmentId: "att-1" }, { userId: "u1", authMode: "user" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBe(true);
    expect(text).toContain("too large for the raw inline fallback");
    expect(text).toContain("Limit: 5.00 MB (5242880 bytes)");
    expect(text).toContain("text/PDF/DOCX/XLSX/PPTX/HTML/ZIP");
    expect(text).toContain("10 minutes");
    expect(mocks.spacesFetchBuffer).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
