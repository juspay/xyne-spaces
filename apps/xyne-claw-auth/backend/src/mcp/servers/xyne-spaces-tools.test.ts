import { beforeEach, describe, expect, it, vi } from "vitest";

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
