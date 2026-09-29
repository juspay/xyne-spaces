import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadRunAttachment = vi.fn(async (_scope: string, id: string, buffer: Buffer) => ({ gcsRef: `runs/${id}`, sizeBytes: buffer.length }) as { gcsRef: string; sizeBytes: number } | null);
const runAttachmentRefsEnabled = vi.fn(() => false);

vi.mock("../config.js", () => ({ CONFIG: { spacesInternalUrl: "http://spaces", attachmentDownloadTimeoutMs: 1000 } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./run-attachment-store.js", () => ({ uploadRunAttachment, runAttachmentRefsEnabled }));

const { toRootAttachmentRefs, downloadRootAttachments, mergeHandoffAttachments, buildHandoffContext } = await import("./workflow-handoff.js");

const pdf = { attachmentId: "att-pdf", fileName: "Flipkart Galaxy APIs.pdf", mimeType: "application/pdf" };

describe("toRootAttachmentRefs", () => {
  it("keeps supported files and drops videos, unsupported types and entries without an id", () => {
    const refs = toRootAttachmentRefs([
      { ...pdf, fileSize: 1, fileUrl: "" },
      { attachmentId: "att-mov", fileName: "demo.mp4", mimeType: "video/mp4" },
      { attachmentId: "att-exe", fileName: "tool.exe", mimeType: "application/x-msdownload" },
      { fileName: "orphan.pdf", mimeType: "application/pdf" },
    ]);
    expect(refs).toEqual([pdf]);
    expect(toRootAttachmentRefs(undefined)).toEqual([]);
  });
});

describe("downloadRootAttachments", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    uploadRunAttachment.mockClear();
    runAttachmentRefsEnabled.mockReturnValue(false);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (text: string) => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
  const miss = { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };

  it("downloads through the apps route with the next agent's token and inlines the bytes", async () => {
    fetchMock.mockResolvedValueOnce(ok("%PDF"));
    const out = await downloadRootAttachments([pdf], { appToken: "app-tok", scopeId: "conv-1" });
    expect(out).toEqual({
      attachments: [{ fileName: pdf.fileName, mimeType: pdf.mimeType, data: Buffer.from("%PDF").toString("base64") }],
      failed: [],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://spaces/api/apps/attachments/att-pdf/download");
    expect((fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer app-tok");
  });

  it("falls back to the user route, parks bytes in run storage when enabled, and reports files it cannot fetch", async () => {
    runAttachmentRefsEnabled.mockReturnValue(true);
    fetchMock.mockResolvedValueOnce(miss).mockResolvedValueOnce(ok("%PDF")).mockResolvedValueOnce(miss).mockRejectedValueOnce(new Error("timeout"));
    const out = await downloadRootAttachments([pdf, { attachmentId: "att-2", fileName: "spec.docx", mimeType: "application/msword" }], { appToken: "t", scopeId: "conv-1" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://spaces/api/attachments/att-pdf/download");
    expect(out.attachments).toEqual([{ fileName: pdf.fileName, mimeType: pdf.mimeType, gcsRef: "runs/att-pdf", sizeBytes: 4 }]);
    expect(out.failed).toEqual(["spec.docx"]);
  });
});

describe("mergeHandoffAttachments", () => {
  it("carries the original files and lets the previous agent's newer file win on a name clash", () => {
    const merged = mergeHandoffAttachments(
      [{ fileName: "Flipkart Galaxy APIs.pdf", mimeType: "application/pdf", data: "a" }, { fileName: "ecofy.md", mimeType: "text/markdown", data: "old" }],
      [{ fileName: "ecofy.md", mimeType: "text/markdown", data: "new" }, { fileName: "ECOFY.json", mimeType: "application/json", data: "{}" }],
    );
    expect(merged.map((a) => [a.fileName, a.data])).toEqual([
      ["Flipkart Galaxy APIs.pdf", "a"],
      ["ecofy.md", "new"],
      ["ECOFY.json", "{}"],
    ]);
  });
});

describe("buildHandoffContext", () => {
  it("pins the original request and its files above the previous agent's output", () => {
    const text = buildHandoffContext({
      rootTask: "create a plan to integrate ECOFY",
      senderName: "Shashwat Shukla",
      rootFileNames: ["Flipkart Galaxy APIs.pdf"],
      failedFileNames: [],
      previousAgentSlug: "integration-planner",
      previousOutput: "plan approved",
    });
    expect(text).toBe(
      "--- Original request from Shashwat Shukla (start of this workflow) ---\ncreate a plan to integrate ECOFY\n\n" +
        "Files attached to the original request (included with this run): Flipkart Galaxy APIs.pdf\n\n" +
        '--- Final output from the previous agent ("integration-planner") ---\nplan approved',
    );
  });

  it("says which original files are missing and caps the previous output", () => {
    const text = buildHandoffContext({
      rootTask: undefined,
      senderName: undefined,
      rootFileNames: [],
      failedFileNames: ["spec.docx"],
      previousAgentSlug: "a",
      previousOutput: "x".repeat(9000),
    });
    expect(text).toContain("could not be downloaded for this run: spec.docx");
    expect(text).not.toContain("Original request");
    expect(text.endsWith("x".repeat(8000))).toBe(true);
    expect(text).not.toContain("x".repeat(8001));
  });
});
