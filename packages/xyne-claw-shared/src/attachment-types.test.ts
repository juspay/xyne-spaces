import { describe, it, expect } from "vitest";
import {
  isSupportedInboundAttachment,
  matchesAttachmentType,
  XLSX_ATTACHMENT,
  TEXT_LIKE_ATTACHMENT,
} from "./attachment-types.js";

describe("isSupportedInboundAttachment", () => {
  it("matches mime prefixes", () => {
    expect(isSupportedInboundAttachment("shot.png", "image/png")).toBe(true);
    expect(isSupportedInboundAttachment("clip.bin", "video/quicktime")).toBe(true);
  });

  it("matches exact mimes", () => {
    expect(isSupportedInboundAttachment("a", "application/pdf")).toBe(true);
    expect(isSupportedInboundAttachment("a", "text/markdown")).toBe(true);
    expect(isSupportedInboundAttachment("a", "application/xhtml+xml")).toBe(true);
  });

  it("falls back to the extension when the mime is missing or opaque", () => {
    expect(isSupportedInboundAttachment("book.xlsx", "application/octet-stream")).toBe(true);
    expect(isSupportedInboundAttachment("book.xlsx", null)).toBe(true);
    expect(isSupportedInboundAttachment("notes.log", undefined)).toBe(true);
    expect(isSupportedInboundAttachment("deck.pptx", "application/octet-stream")).toBe(true);
  });

  it("rejects unsupported files", () => {
    expect(isSupportedInboundAttachment("payload.exe", "application/octet-stream")).toBe(false);
    expect(isSupportedInboundAttachment("noext", "application/octet-stream")).toBe(false);
    expect(isSupportedInboundAttachment("a.dmg", null)).toBe(false);
  });

  it("accepts every zip mime spelling", () => {
    for (const m of ["application/zip", "application/x-zip-compressed", "application/x-zip"]) {
      expect(isSupportedInboundAttachment("bundle", m)).toBe(true);
    }
    expect(isSupportedInboundAttachment("bundle.zip", "application/octet-stream")).toBe(true);
  });

  it("accepts macro-enabled workbooks regardless of mime casing", () => {
    expect(isSupportedInboundAttachment("m", "application/vnd.ms-excel.sheet.macroEnabled.12")).toBe(true);
    expect(isSupportedInboundAttachment("m", "application/vnd.ms-excel.sheet.macroenabled.12")).toBe(true);
    expect(
      matchesAttachmentType("m", "application/vnd.ms-excel.sheet.macroEnabled.12", XLSX_ATTACHMENT.mimeTypes, new Set()),
    ).toBe(true);
  });

  it("accepts text-like mimes that no claw handler declared", () => {
    for (const m of ["application/yaml", "text/yaml", "application/xml", "text/xml", "text/csv", "application/json"]) {
      expect(isSupportedInboundAttachment("data", m)).toBe(true);
      expect(TEXT_LIKE_ATTACHMENT.mimeTypes.has(m)).toBe(true);
    }
  });
});
