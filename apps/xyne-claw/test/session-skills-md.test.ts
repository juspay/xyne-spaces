/**
 * session-skills-md.test.ts — markdown-sibling extraction for binary skill
 * documents (PDF/DOCX/…) at materialization time. Covers the report's
 * validation plan: unsupported types produce nothing, corrupt documents never
 * fail the materialization (raw binary kept, no .md), and an author-provided
 * `<name>.pdf.md` always wins over auto-generation.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// PATHS.dataDir is read at module load — point it at a temp dir BEFORE the
// import so test artifacts never land in ./data.
process.env["XYNE_CLAW_DATA_DIR"] = join(tmpdir(), `skill-md-test-${Date.now()}`);

const { writeSessionSkills, deleteSessionSkills } = await import("../src/session-skills.js");
const { documentBufferToMarkdown } = await import("../src/attachment-ingest.js");

/** Minimal single-page PDF with the literal text "Hello Skill" — small enough
 *  to inline, real enough for unpdf's extractText. */
const MINIMAL_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 72 720 Td (Hello Skill) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
trailer<</Size 6/Root 1 0 R>>
startxref
0
%%EOF`,
  "latin1",
);

const scopes: string[] = [];
function scope(name: string): string {
  const s = `${name}-${Date.now()}`;
  scopes.push(s);
  return s;
}

afterEach(async () => {
  while (scopes.length) await deleteSessionSkills(scopes.pop()!);
});

const baseSkill = { name: "Doc Skill", slug: "doc-skill", content: "# Doc skill\nRead the bundled docs." };

describe("documentBufferToMarkdown", () => {
  it("returns null for unsupported types", async () => {
    expect(await documentBufferToMarkdown(Buffer.from("PNGDATA"), "logo.png", "image/png")).toBeNull();
    expect(await documentBufferToMarkdown(Buffer.from("bytes"), "data.bin", "application/octet-stream")).toBeNull();
  });

  it("extracts text from a PDF buffer", async () => {
    const md = await documentBufferToMarkdown(MINIMAL_PDF, "hello.pdf", "application/pdf");
    expect(md).not.toBeNull();
    expect(md).toContain("Hello Skill");
  });
});

describe("writeSessionSkills markdown siblings", () => {
  it("writes <name>.pdf.md next to a bundled PDF", async () => {
    const s = scope("pdf-ok");
    const dir = await writeSessionSkills(s, [
      {
        ...baseSkill,
        files: [{ relativePath: "docs/hello.pdf", content: MINIMAL_PDF.toString("base64"), contentType: "application/pdf" }],
      },
    ]);
    expect(dir).not.toBeNull();
    const raw = await readFile(join(dir!, "doc-skill", "docs", "hello.pdf"));
    expect(raw.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const md = await readFile(join(dir!, "doc-skill", "docs", "hello.pdf.md"), "utf8");
    expect(md).toContain("Hello Skill");
  });

  it("keeps the raw binary and writes a visible error stub for a corrupt PDF (never throws)", async () => {
    const s = scope("pdf-corrupt");
    const dir = await writeSessionSkills(s, [
      {
        ...baseSkill,
        files: [{ relativePath: "broken.pdf", content: Buffer.from("not a pdf at all").toString("base64"), contentType: "application/pdf" }],
      },
    ]);
    expect(dir).not.toBeNull();
    await access(join(dir!, "doc-skill", "broken.pdf")); // raw file materialized
    // pdfBufferToMarkdown never throws — corrupt input yields an error-stub
    // sibling (same contract as chat attachments) so the failure is visible
    // to the model instead of silent.
    const md = await readFile(join(dir!, "doc-skill", "broken.pdf.md"), "utf8");
    expect(md).toContain("Failed to extract PDF text");
  });

  it("never clobbers an author-provided .pdf.md sibling", async () => {
    const s = scope("author-md");
    const authored = "# Authored summary — do not overwrite";
    const dir = await writeSessionSkills(s, [
      {
        ...baseSkill,
        files: [
          { relativePath: "guide.pdf", content: MINIMAL_PDF.toString("base64"), contentType: "application/pdf" },
          { relativePath: "guide.pdf.md", content: authored, contentType: "text/markdown" },
        ],
      },
    ]);
    const md = await readFile(join(dir!, "doc-skill", "guide.pdf.md"), "utf8");
    expect(md).toBe(authored);
  });

  it("writes no sibling for non-document binaries", async () => {
    const s = scope("png");
    const dir = await writeSessionSkills(s, [
      {
        ...baseSkill,
        files: [{ relativePath: "logo.png", content: Buffer.from("fakepng").toString("base64"), contentType: "image/png" }],
      },
    ]);
    await access(join(dir!, "doc-skill", "logo.png"));
    await expect(access(join(dir!, "doc-skill", "logo.png.md"))).rejects.toThrow();
  });
});
