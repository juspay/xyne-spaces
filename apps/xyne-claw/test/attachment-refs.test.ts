import { beforeEach, describe, expect, it, vi } from "vitest";

const gcsDownloadObject = vi.fn(async (_name: string): Promise<Buffer | null> => null);

vi.mock("../src/storage.js", () => ({ gcsDownloadObject }));

const { hydrateAttachmentRefs } = await import("../src/attachment-ingest.js");

const logs: string[] = [];
const log = (m: string) => void logs.push(m);

beforeEach(() => {
  logs.length = 0;
  gcsDownloadObject.mockReset();
  gcsDownloadObject.mockResolvedValue(null);
});

describe("hydrateAttachmentRefs — both attachment shapes are accepted", () => {
  it("passes inline base64 through untouched (recovery-replayed payloads)", async () => {
    const inline = { fileName: "a.txt", mimeType: "text/plain", data: "aGk=" };

    const out = await hydrateAttachmentRefs([inline], log);

    expect(gcsDownloadObject).not.toHaveBeenCalled();
    expect(out).toEqual([inline]);
  });

  it("downloads a gcsRef attachment and inlines its bytes as base64", async () => {
    gcsDownloadObject.mockResolvedValue(Buffer.from("hello attachments"));

    const out = await hydrateAttachmentRefs(
      [
        {
          fileName: "notes.txt",
          mimeType: "text/plain",
          gcsRef: "run-attachments/conv-1/att-123",
          sizeBytes: 17,
        },
      ],
      log,
    );

    expect(gcsDownloadObject).toHaveBeenCalledWith("run-attachments/conv-1/att-123");
    expect(out).toHaveLength(1);
    expect(out[0]!.data).toBe(Buffer.from("hello attachments").toString("base64"));
  });

  it("handles a mixed batch of both shapes in order", async () => {
    gcsDownloadObject.mockResolvedValue(Buffer.from("remote"));

    const out = await hydrateAttachmentRefs(
      [
        { fileName: "inline.txt", mimeType: "text/plain", data: "aQ==" },
        { fileName: "remote.txt", mimeType: "text/plain", gcsRef: "run-attachments/c/r" },
      ],
      log,
    );

    expect(out.map((a) => a.fileName)).toEqual(["inline.txt", "remote.txt"]);
    expect(out[0]!.data).toBe("aQ==");
    expect(out[1]!.data).toBe(Buffer.from("remote").toString("base64"));
  });

  it("drops a ref whose bytes cannot be fetched instead of failing the run", async () => {
    gcsDownloadObject.mockResolvedValue(null);

    const out = await hydrateAttachmentRefs(
      [{ fileName: "gone.txt", mimeType: "text/plain", gcsRef: "run-attachments/c/gone" }],
      log,
    );

    expect(out).toEqual([]);
    expect(logs.join(" ")).toContain("could not be fetched from object storage");
  });
});
