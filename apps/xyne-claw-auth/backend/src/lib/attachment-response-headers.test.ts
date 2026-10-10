import { describe, expect, it } from "vitest";
import { attachmentResponseHeaders, THUMBNAIL_RESPONSE_HEADERS } from "./attachment-response-headers.js";

const headersFor = (mimeType: string | null, originalFilename = "file.bin") =>
  attachmentResponseHeaders({ mimeType, originalFilename });

describe("attachmentResponseHeaders (XYNE-65486 / C-9)", () => {
  it.each([
    "text/html",
    "TEXT/HTML; charset=utf-8",
    "application/xhtml+xml",
    "application/xml",
    "text/xml",
    "application/unknown",
    "application/octet-stream",
    "text/javascript",
    "multipart/x-mixed-replace",
    "",
  ])("forces %j to an opaque nosniff download", (mime) => {
    const h = headersFor(mime, "evil.html");
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"]).toBe('attachment; filename="evil.html"');
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toBeUndefined();
  });

  it("treats a null mimeType as unsafe", () => {
    expect(headersFor(null)["Content-Type"]).toBe("application/octet-stream");
  });

  it.each(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "video/mp4", "audio/mpeg"])(
    "keeps %s inline with nosniff",
    (mime) => {
      const h = headersFor(`${mime}; charset=binary`, "ok.file");
      expect(h["Content-Type"]).toBe(mime);
      expect(h["Content-Disposition"]).toBe('inline; filename="ok.file"');
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
    },
  );

  it("renders SVG inline only under a script-blocking sandbox CSP", () => {
    const h = headersFor("image/svg+xml", "diagram.svg");
    expect(h["Content-Type"]).toBe("image/svg+xml");
    expect(h["Content-Disposition"]).toBe('inline; filename="diagram.svg"');
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(h["Content-Security-Policy"]).not.toContain("allow-scripts");
    expect(h["Content-Security-Policy"]).not.toContain("allow-same-origin");
  });

  it("encodes the filename so it cannot break out of the header", () => {
    const h = headersFor("text/plain", 'a"; x=1\r\nSet-Cookie: s=1.txt');
    expect(h["Content-Disposition"]).not.toMatch(/[\r\n"]\s*;?\s*x=1/);
    expect(h["Content-Disposition"]).toContain(encodeURIComponent('a"; x=1\r\nSet-Cookie: s=1.txt'));
  });

  it("thumbnail headers pin image/jpeg with nosniff", () => {
    expect(THUMBNAIL_RESPONSE_HEADERS).toEqual({ "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff" });
  });
});
