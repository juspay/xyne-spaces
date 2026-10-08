import { describe, expect, it } from "vitest";

import { isDocxAttachment } from "../src/docx-attachment.js";
import { isHtmlAttachment } from "../src/html-attachment.js";
import { isPdfAttachment } from "../src/pdf-attachment.js";
import { isPptxAttachment } from "../src/pptx-attachment.js";
import { isVideoAttachment } from "../src/video-attachment.js";
import { isXlsxAttachment } from "../src/xlsx-attachment.js";
import { isZipAttachment } from "../src/zip-attachment.js";

type AttachmentMatcher = (fileName: string, mimeType?: string | null) => boolean;

const attachmentTypes: Array<{
  name: string;
  match: AttachmentMatcher;
  extension: string;
  mimeType: string;
}> = [
  { name: "PDF", match: isPdfAttachment, extension: ".pdf", mimeType: "application/pdf" },
  {
    name: "XLSX",
    match: isXlsxAttachment,
    extension: ".xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    name: "DOCX",
    match: isDocxAttachment,
    extension: ".docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    name: "PPTX",
    match: isPptxAttachment,
    extension: ".pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  { name: "ZIP", match: isZipAttachment, extension: ".zip", mimeType: "application/zip" },
  { name: "HTML", match: isHtmlAttachment, extension: ".html", mimeType: "text/html" },
  { name: "video", match: isVideoAttachment, extension: ".mp4", mimeType: "video/mp4" },
];

describe.each(attachmentTypes)("$name attachment matching", ({ match, extension, mimeType }) => {
  it("matches a valid MIME type regardless of case", () => {
    expect(match("attachment.unknown", mimeType.toUpperCase())).toBe(true);
  });

  it.each([null, undefined])(
    "falls back to the extension when MIME is %s",
    (missingMimeType) => {
      expect(match(`attachment${extension.toUpperCase()}`, missingMimeType)).toBe(true);
    },
  );

  it("does not match when MIME and extension are unsupported", () => {
    expect(match("attachment.unknown", "application/octet-stream")).toBe(false);
  });

  it("does not match a missing MIME without a file extension", () => {
    expect(match("attachment", undefined)).toBe(false);
  });
});
