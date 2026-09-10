import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { extractXlsxText, isXlsxFile } from "./kb-xlsx.js";

describe("KB XLSX extraction", () => {
  it("detects modern Excel workbooks from content type or filename", () => {
    expect(isXlsxFile("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "report.bin")).toBe(true);
    expect(isXlsxFile("application/octet-stream", "Holiday List - 2026.xlsx")).toBe(true);
    expect(isXlsxFile("application/vnd.ms-excel", "legacy.xls")).toBe(false);
    expect(isXlsxFile("application/pdf", "report.pdf")).toBe(false);
  });

  it("extracts sheet names, row numbers, cell coordinates and values", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Holidays");
    sheet.addRow(["Date", "Holiday", "Region"]);
    sheet.addRow([new Date("2026-10-02T00:00:00.000Z"), "Gandhi Jayanti", "IN"]);
    sheet.addRow([new Date("2026-11-08T00:00:00.000Z"), "Diwali", "IN"]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const text = await extractXlsxText(buffer, "Holiday List - 2026.xlsx");

    expect(text).toContain("## Holiday List - 2026.xlsx");
    expect(text).toContain("### Sheet: Holidays");
    expect(text).toContain("Row 1: A1: Date | B1: Holiday | C1: Region");
    expect(text).toContain("B2: Gandhi Jayanti");
    expect(text).toContain("B3: Diwali");
  });
});
