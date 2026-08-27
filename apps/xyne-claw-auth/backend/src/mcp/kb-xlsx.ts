import ExcelJS from "exceljs";

const XLSX_CONTENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
]);

export function isXlsxFile(contentType: string, fileName: string): boolean {
  const normalizedContentType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const normalizedFileName = fileName.toLowerCase();
  return (
    XLSX_CONTENT_TYPES.has(normalizedContentType) ||
    normalizedFileName.endsWith(".xlsx") ||
    normalizedFileName.endsWith(".xlsm")
  );
}

function stringifyCellValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("");
    }
    if ("formula" in value) {
      const result = "result" in value ? stringifyCellValue(value.result as ExcelJS.CellValue) : "";
      return result ? `${result} (formula: =${value.formula})` : `=${value.formula}`;
    }
    if ("hyperlink" in value) {
      const text = "text" in value && typeof value.text === "string" ? value.text : "";
      return text && text !== value.hyperlink ? `${text} (${value.hyperlink})` : String(value.hyperlink);
    }
    if ("error" in value) return String(value.error);
  }
  return String(value);
}

export async function extractXlsxText(buffer: Buffer, fileName: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const lines: string[] = [`## ${fileName}`, "", "_Extracted from Excel workbook._"];
  workbook.worksheets.forEach((worksheet) => {
    lines.push("", `### Sheet: ${worksheet.name}`);
    let nonEmptyRows = 0;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const value = stringifyCellValue(cell.value).trim();
        if (!value) return;
        const address = `${worksheet.getColumn(colNumber).letter}${rowNumber}`;
        cells.push(`${address}: ${value.replace(/\r?\n/g, " ")}`);
      });
      if (cells.length > 0) {
        nonEmptyRows++;
        lines.push(`Row ${rowNumber}: ${cells.join(" | ")}`);
      }
    });
    if (nonEmptyRows === 0) lines.push("_Empty sheet._");
  });

  const text = lines.join("\n");
  return text.length > 100_000 ? `${text.slice(0, 100_000)}\n\n…(truncated to 100k characters)` : text;
}
