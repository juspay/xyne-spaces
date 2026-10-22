import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { xlsxBufferToMarkdown } from "../src/xlsx-attachment.js";
import { writeAttachmentToContext } from "../src/attachment-write.js";

async function workbook(sheets: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (let i = 1; i <= sheets; i++) wb.addWorksheet(`Sheet ${i}`).addRow([`value ${i}`]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("large workbooks", () => {
  it("names every sheet left out of the markdown and points at the original", async () => {
    const md = await xlsxBufferToMarkdown(await workbook(25), "plan.xlsx");

    expect(md).toContain("25 sheets total; showing the first 20");
    expect(md).toContain("Not shown: Sheet 21, Sheet 22, Sheet 23, Sheet 24, Sheet 25.");
    expect(md).toContain("The original workbook is saved next to this file");
    expect(md).not.toContain("## Sheet: Sheet 21");
  });

  it("keeps the original workbook next to its markdown when fetched mid-run", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xlsx-"));
    try {
      const buf = await workbook(2);
      const result = await writeAttachmentToContext(
        dir,
        "plan.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buf,
      );

      expect(result.relPath).toBe(".context/plan.xlsx.md");
      expect((await readFile(path.join(dir, ".context", "plan.xlsx"))).equals(buf)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
