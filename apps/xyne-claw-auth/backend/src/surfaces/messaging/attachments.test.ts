import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadFile = vi.fn(async () => undefined);
// config.ts reads required env at import time; the store only needs the flag.
vi.mock("../../config.js", () => ({ CONFIG: { get runAttachmentRefs() { return process.env["XYNE_RUN_ATTACHMENT_REFS"] === "1"; } } }));
vi.mock("../../services/storageService.js", () => ({ gcsService: { uploadFile } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));

const { runAttachmentRefsEnabled, uploadRunAttachment } = await import("../../lib/run-attachment-store.js");

/** The dispatch body's per-attachment branch, same shape as dispatch.ts. */
async function toRunAttachments(
  conversationId: string,
  messageKey: string,
  files: ReadonlyArray<{ fileName: string; mimeType: string; data: Buffer }>,
) {
  const useRefs = runAttachmentRefsEnabled();
  return Promise.all(
    files.map(async (file, index) => {
      const uploaded = useRefs
        ? await uploadRunAttachment(conversationId, `${messageKey}-${index}`, file.data, file.mimeType)
        : null;
      return uploaded
        ? { fileName: file.fileName, mimeType: file.mimeType, gcsRef: uploaded.gcsRef, sizeBytes: uploaded.sizeBytes }
        : { fileName: file.fileName, mimeType: file.mimeType, data: file.data.toString("base64"), sizeBytes: file.data.length };
    }),
  );
}

const photo = { fileName: "receipt.jpg", mimeType: "image/jpeg", data: Buffer.from("not-really-a-jpeg") };

beforeEach(() => {
  uploadFile.mockClear();
  delete process.env["XYNE_RUN_ATTACHMENT_REFS"];
});
afterEach(() => vi.resetModules());

describe("channel attachments in the run body", () => {
  it("inlines base64 when refs are off, so nothing changes by default", async () => {
    const out = await toRunAttachments("whatsapp-acct_1-ask-ai-12036_g_us", "whatsapp:acct:MSG1", [photo]);
    expect(out[0]).toMatchObject({ fileName: "receipt.jpg", data: photo.data.toString("base64") });
    expect(out[0]).not.toHaveProperty("gcsRef");
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("keeps the attachment when storage fails, rather than losing the person's file", async () => {
    process.env["XYNE_RUN_ATTACHMENT_REFS"] = "1";
    vi.resetModules();
    uploadFile.mockRejectedValueOnce(new Error("bucket unreachable"));
    const { runAttachmentRefsEnabled: enabled, uploadRunAttachment: upload } = await import(
      "../../lib/run-attachment-store.js"
    );
    const uploaded = enabled() ? await upload("conv", "att", photo.data, photo.mimeType) : null;
    expect(uploaded).toBeNull();
  });

  it("gives each file in one message its own object path", async () => {
    const paths = new Set<string>();
    const { runAttachmentObjectPath } = await import("../../lib/run-attachment-store.js");
    for (let i = 0; i < 3; i++) paths.add(runAttachmentObjectPath("conv-1", `whatsapp:acct:MSG1-${i}`));
    expect(paths.size).toBe(3);
  });
});
