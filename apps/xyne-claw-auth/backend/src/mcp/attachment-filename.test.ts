import { describe, expect, it } from "vitest";
import {
  extForMime,
  fileNameFromResource,
  sanitizeResourceFileName,
} from "./attachment-filename.js";

const BS = String.fromCharCode(92); // a single backslash

describe("extForMime", () => {
  it("maps Office + mp4 + common types that previously fell back to bin", () => {
    expect(extForMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(extForMime("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("pptx");
    expect(extForMime("application/msword")).toBe("doc");
    expect(extForMime("application/vnd.ms-powerpoint")).toBe("ppt");
    expect(extForMime("video/mp4")).toBe("mp4");
    expect(extForMime("text/plain")).toBe("txt");
    expect(extForMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("xlsx");
  });
  it("keeps existing mappings and falls back to bin for unknown", () => {
    expect(extForMime("application/pdf")).toBe("pdf");
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("application/octet-stream")).toBe("bin");
  });
});

describe("sanitizeResourceFileName", () => {
  it("returns the basename of a uri", () => {
    expect(sanitizeResourceFileName("npci-doc://host/dir/product_note_v1.docx")).toBe("product_note_v1.docx");
  });
  it("strips query and fragment", () => {
    expect(sanitizeResourceFileName("doc://a/file.pdf?token=abc#frag")).toBe("file.pdf");
  });
  it("neutralises ../ path traversal (basename only)", () => {
    expect(sanitizeResourceFileName("npci-doc://x/../../etc/passwd")).toBe("passwd");
  });
  it("neutralises backslash traversal", () => {
    expect(sanitizeResourceFileName("evil" + BS + ".." + BS + "secret.docx")).toBe("secret.docx");
  });
  it("re-cuts on percent-encoded separators after decoding", () => {
    expect(sanitizeResourceFileName("doc://a/%2Fetc%2Fpasswd")).toBe("passwd");
  });
  it("strips leading dots", () => {
    expect(sanitizeResourceFileName("path/....hidden")).toBe("hidden");
  });
  it("removes control chars", () => {
    expect(sanitizeResourceFileName("doc://a/re" + String.fromCharCode(0) + "port.pdf")).toBe("report.pdf");
  });
  it("returns empty when nothing usable remains", () => {
    expect(sanitizeResourceFileName("doc://host/")).toBe("");
    expect(sanitizeResourceFileName("doc://host/...")).toBe("");
  });
});

describe("fileNameFromResource", () => {
  it("honors the uri filename when it already has an extension", () => {
    expect(
      fileNameFromResource("npci-doc://x/product_note_v1.docx", "application/octet-stream", "fetch_document_file", 1),
    ).toBe("product_note_v1.docx");
  });
  it("appends the mime extension when the uri basename has none", () => {
    expect(
      fileNameFromResource(
        "npci-doc://x/product_note",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "fetch_document_file",
        1,
      ),
    ).toBe("product_note.docx");
  });
  it("falls back to tool-idx.ext when there is no uri", () => {
    expect(fileNameFromResource(undefined, "video/mp4", "gen", 2)).toBe("gen-2.mp4");
    expect(fileNameFromResource(null, "application/octet-stream", "gen", 3)).toBe("gen-3.bin");
  });
  it("falls back when the uri has no usable basename", () => {
    expect(fileNameFromResource("npci-doc://host/", "application/pdf", "tool", 4)).toBe("tool-4.pdf");
  });
  it("sanitises a hostile uri instead of trusting it", () => {
    expect(
      fileNameFromResource("npci-doc://x/../../etc/passwd", "application/octet-stream", "tool", 5),
    ).toBe("passwd.bin");
  });
});
