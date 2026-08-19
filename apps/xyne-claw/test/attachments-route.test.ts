import { beforeEach, describe, expect, it, vi } from "vitest";

process.env["XYNE_CLAW_S2S_KEY"] = "s2s-secret";

describe("attachment ingest URL inputs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("downloads a signed URL and materializes it as base64 for ingest", async () => {
    const bytes = new TextEncoder().encode("hello world");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "11" }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })));

    const { materializeIngestAttachments } = await import("../src/routes/attachments.js");
    const attachments = await materializeIngestAttachments([{
      fileName: "report.txt",
      mimeType: "text/plain",
      url: "https://storage.googleapis.com/bucket/signed-report-url",
      size: 11,
    }]);

    expect(attachments).toEqual([{
      fileName: "report.txt",
      mimeType: "text/plain",
      data: Buffer.from("hello world").toString("base64"),
    }]);
    // The fence parses the URL and forbids redirects (a 302 to an internal host
    // would otherwise bypass the host allowlist), so assert both.
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ href: "https://storage.googleapis.com/bucket/signed-report-url" }),
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });
});

describe("URL ingest SSRF fence", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  const reject = async (url: string): Promise<string> => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch should not be called"); }));
    const { materializeIngestAttachments } = await import("../src/routes/attachments.js");
    try {
      await materializeIngestAttachments([{ fileName: "x.pdf", mimeType: "application/pdf", url }]);
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  it("blocks the cloud metadata server (would leak this pod's credentials)", async () => {
    const msg = await reject("http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token");
    expect(msg).toMatch(/not an allowed storage host/i);
    expect(msg).not.toContain("computeMetadata");
  });

  it("blocks internal cluster hosts", async () => {
    expect(await reject("http://xyne-backend.xyne-apps.svc.cluster.local:3001/api/internal/whatever"))
      .toMatch(/not an allowed storage host/i);
  });

  it("blocks a lookalike host that merely contains the allowed one", async () => {
    expect(await reject("https://storage.googleapis.com.evil.tld/o/x.pdf"))
      .toMatch(/not an allowed storage host/i);
  });

  it("allows a genuine GCS signed URL", async () => {
    const bytes = new TextEncoder().encode("ok");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "2" }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })));
    const { materializeIngestAttachments } = await import("../src/routes/attachments.js");
    const out = await materializeIngestAttachments([{
      fileName: "a.txt", mimeType: "text/plain",
      url: "https://storage.googleapis.com/bucket/o/a.txt?X-Goog-Signature=abc",
    }]);
    expect(out[0]?.fileName).toBe("a.txt");
  });
});
