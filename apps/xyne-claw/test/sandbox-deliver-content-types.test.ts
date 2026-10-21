import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxContentType } from "xyne-claw-shared";

/**
 * Files the agent builds in the sandbox and sends back with
 * `sandbox-deliver-files` must arrive labelled with their real content type.
 *
 * The map used to cover 9 extensions, so a genuine .xlsx / .docx / .pptx left
 * the sandbox as `application/octet-stream` — which is what GCS then stores as
 * the object's content type. Nothing REJECTS it (Spaces' upload filter is
 * extension-primary), but the download gets the wrong type, there is no inline
 * preview, and the OS opens it with the wrong application.
 */
describe("sandboxContentType covers what agents actually produce", () => {
  const cases: Array<[string, string]> = [
    ["report.pdf", "application/pdf"],
    ["data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["legacy.xls", "application/vnd.ms-excel"],
    ["deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["deck.ppt", "application/vnd.ms-powerpoint"],
    ["letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["letter.doc", "application/msword"],
    ["notes.txt", "text/plain"],
    ["readme.md", "text/markdown"],
    ["rows.csv", "text/csv"],
    ["config.json", "application/json"],
    ["main.ts", "text/x-typescript"],
    ["script.py", "text/x-python"],
    ["chart.png", "image/png"],
    ["bundle.zip", "application/zip"],
  ];

  for (const [file, expected] of cases) {
    it(`labels ${file} as ${expected}`, () => {
      expect(sandboxContentType(file)).toBe(expected);
    });
  }

  it("is case-insensitive on the extension", () => {
    expect(sandboxContentType("REPORT.PDF")).toBe("application/pdf");
  });

  it("falls back to octet-stream for an unknown extension and for no extension", () => {
    expect(sandboxContentType("mystery.qqq")).toBe("application/octet-stream");
    expect(sandboxContentType("Makefile")).toBe("application/octet-stream");
  });

  /**
   * Guard against labelling a type Spaces would then refuse: its upload filter
   * is an extension ALLOW-list, so every extension we name here must be in it.
   */
  it("never labels an extension outside Spaces' upload allow-list", () => {
    const uploadTs = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../backend/src/middleware/upload.ts"),
      "utf8",
    );
    const block = /const ALLOWED_UPLOAD_EXTENSIONS = new Set\(\[([\s\S]*?)\]\)/.exec(uploadTs);
    expect(block, "ALLOWED_UPLOAD_EXTENSIONS not found — did upload.ts move?").toBeTruthy();
    const allowed = new Set([...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
    expect(allowed.size).toBeGreaterThan(50);

    for (const [file] of cases) {
      const ext = file.split(".").pop()!.toLowerCase();
      expect(allowed.has(ext), `${ext} is labelled but not upload-allowlisted`).toBe(true);
    }
  });
});
