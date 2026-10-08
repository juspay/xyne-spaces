import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadFile = vi.fn(async () => undefined);

vi.mock("../services/storageService.js", () => ({
  gcsService: { uploadFile },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

const { runAttachmentRefsEnabled, runAttachmentObjectPath, uploadRunAttachment } = await import(
  "./run-attachment-store.js"
);

/**
 * The webhook's per-attachment push, lifted verbatim in shape so the test
 * exercises the branch the dispatch body actually carries.
 */
async function pushAttachment(
  out: Array<Record<string, unknown>>,
  scopeId: string,
  att: { attachmentId: string; fileName: string; mimeType: string },
  buffer: Buffer,
): Promise<void> {
  const uploaded = runAttachmentRefsEnabled()
    ? await uploadRunAttachment(scopeId, att.attachmentId, buffer, att.mimeType)
    : null;
  if (uploaded) {
    out.push({
      fileName: att.fileName,
      mimeType: att.mimeType,
      gcsRef: uploaded.gcsRef,
      sizeBytes: uploaded.sizeBytes,
    });
  } else {
    out.push({
      fileName: att.fileName,
      mimeType: att.mimeType,
      data: buffer.toString("base64"),
    });
  }
}

const att = { attachmentId: "att-123", fileName: "notes.txt", mimeType: "text/plain" };
const buffer = Buffer.from("hello attachments");

beforeEach(() => {
  uploadFile.mockClear();
  uploadFile.mockResolvedValue(undefined);
  delete process.env["XYNE_RUN_ATTACHMENT_REFS"];
});

afterEach(() => {
  delete process.env["XYNE_RUN_ATTACHMENT_REFS"];
});

describe("run attachment shapes", () => {
  it("inlines base64 and never touches storage when the flag is off (today's behaviour)", async () => {
    const out: Array<Record<string, unknown>> = [];
    await pushAttachment(out, "conv-1", att, buffer);

    expect(uploadFile).not.toHaveBeenCalled();
    expect(out).toEqual([
      { fileName: "notes.txt", mimeType: "text/plain", data: buffer.toString("base64") },
    ]);
    expect(out[0]).not.toHaveProperty("gcsRef");
  });

  it("emits a gcsRef with no base64 when the flag is on", async () => {
    process.env["XYNE_RUN_ATTACHMENT_REFS"] = "1";
    const out: Array<Record<string, unknown>> = [];
    await pushAttachment(out, "conv-1", att, buffer);

    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledWith(buffer, "run-attachments/conv-1/att-123", "text/plain");
    expect(out).toEqual([
      {
        fileName: "notes.txt",
        mimeType: "text/plain",
        gcsRef: "run-attachments/conv-1/att-123",
        sizeBytes: buffer.length,
      },
    ]);
    expect(out[0]).not.toHaveProperty("data");
  });

  it("falls back to inline base64 when the upload fails", async () => {
    process.env["XYNE_RUN_ATTACHMENT_REFS"] = "1";
    uploadFile.mockRejectedValueOnce(new Error("bucket on fire"));
    const out: Array<Record<string, unknown>> = [];
    await pushAttachment(out, "conv-1", att, buffer);

    expect(out[0]).toEqual({
      fileName: "notes.txt",
      mimeType: "text/plain",
      data: buffer.toString("base64"),
    });
  });

  it("sanitises unsafe id segments in the object path", () => {
    expect(runAttachmentObjectPath("conv/../1", "a b#c")).toBe("run-attachments/conv_.._1/a_b_c");
  });
});
