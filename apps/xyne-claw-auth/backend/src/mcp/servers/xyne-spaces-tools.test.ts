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

  it("falls back to /download when the signed-url route is unavailable, ingesting via base64 data", async () => {
    // The prod bug: /signed-url is not deployed, so it 404s. The tool must not
    // give up — it fetches the bytes via the authenticated /download route and
    // hands claw base64 `data` instead of a `url`.
    mockMeta();
    mocks.spacesFetch.mockRejectedValueOnce(new Error("Spaces API 404: Not Found"));
    mocks.spacesFetchBuffer.mockResolvedValueOnce({
      buffer: Buffer.from("%PDF-1.7 fake bytes"),
      contentType: "application/pdf",
    });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, files: [{ path: "report.md", content: "Findings summary" }] }),
    } as Response);

    const tool = await fetchAttachmentTool();
    const result = await tool.handler({ attachmentId: "att-1" }, { userId: "u1", authMode: "user" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("via a direct download");
    expect(text).toContain("Findings summary");
    expect(mocks.spacesFetchBuffer).toHaveBeenCalledWith("/api/attachments/att-1/download");
    // claw receives base64 `data`, never a `url`, on the fallback path.
    const ingestBody = JSON.parse((vi.mocked(global.fetch).mock.calls[0]![1] as { body: string }).body);
    expect(ingestBody.attachments[0].data).toBe(Buffer.from("%PDF-1.7 fake bytes").toString("base64"));
    expect(ingestBody.attachments[0].url).toBeUndefined();
  });

  it("returns unsupported-but-small file bytes inline via the /download fallback without a second fetch", async () => {
    mockMeta({ originalFilename: "capture.bin", mimetype: "application/octet-stream", size: 1024 });
    mocks.spacesFetch.mockRejectedValueOnce(new Error("Spaces API 404: Not Found"));
    mocks.spacesFetchBuffer.mockResolvedValueOnce({
      buffer: Buffer.from("raw-bytes"),
      contentType: "application/octet-stream",
    });

    const tool = await fetchAttachmentTool();
    const result = await tool.handler({ attachmentId: "att-1" }, { userId: "u1", authMode: "user" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBeUndefined();
    expect(text).toContain("[SPACES_ATTACHMENT:capture.bin:application/octet-stream]");
    expect(text).toContain(Buffer.from("raw-bytes").toString("base64"));
    // The bytes were already pulled for the fallback — do not fetch them again.
    expect(mocks.spacesFetchBuffer).toHaveBeenCalledTimes(1);
  });

  it("returns an honest not-found/no-access error when BOTH signed-url and /download fail", async () => {
    // /download runs the real attachment ACL, so a failure here is genuine —
    // the message must not claim a storage outage or suggest re-uploading.
    mockMeta();
    mocks.spacesFetch.mockRejectedValueOnce(new Error("Spaces API 404: Not Found"));
    mocks.spacesFetchBuffer.mockRejectedValueOnce(new Error("Spaces API 403: Forbidden"));

    const tool = await fetchAttachmentTool();
    const result = await tool.handler({ attachmentId: "att-1" }, { userId: "u1", authMode: "user" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBe(true);
    expect(text).toContain("neither the signed-url nor the direct-download route returned it");
    expect(text).toContain("does not have access");
    expect(text).not.toMatch(/storage backend|re-upload/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not attempt the /download fallback for a file over the fallback size limit", async () => {
    mockMeta({ originalFilename: "huge.pdf", mimetype: "application/pdf", size: 80 * 1024 * 1024 });
    mocks.spacesFetch.mockRejectedValueOnce(new Error("Spaces API 404: Not Found"));

    const tool = await fetchAttachmentTool();
    const result = await tool.handler({ attachmentId: "att-1" }, { userId: "u1", authMode: "user" });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).toBe(true);
    expect(text).toContain("direct-download limit");
    expect(mocks.spacesFetchBuffer).not.toHaveBeenCalled();
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
    expect(mocks.spacesFetchBuffer).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
