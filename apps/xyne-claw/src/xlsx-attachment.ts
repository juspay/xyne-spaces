/**
 * XLSX attachment decoder.
 *
 * Converts a user-uploaded .xlsx workbook into a multi-sheet markdown text
 * blob, so it can flow through the same `.context/<name>.md` path that .csv /
 * .md / .txt already use. The agent reads it via its file-read tool — we do
 * NOT pass it as vision content (it's not an image) and we do NOT keep the
 * binary on disk (the agent can't manipulate xlsx natively anyway).
 *
 * Safety caps prevent a 100k-row sheet from blowing the agent's token budget:
 * MAX_SHEETS sheets, MAX_ROWS rows per sheet, MAX_COLS cols per sheet, with
 * a footer noting truncation. Bad/corrupt xlsx → returns a one-line error
 * blob so the agent can still see the filename and skip cleanly.
 */
import ExcelJS from "exceljs";
import { matchesAttachmentType, XLSX_ATTACHMENT } from "xyne-claw-shared";

const MAX_SHEETS = 20;
const MAX_ROWS_PER_SHEET = 1000;
const MAX_COLS_PER_SHEET = 50;
const MAX_CELL_CHARS = 300;

export const XLSX_MIME_TYPES = XLSX_ATTACHMENT.mimeTypes;
export const XLSX_EXTENSIONS = XLSX_ATTACHMENT.extensions;

export function isXlsxAttachment(fileName: string, mimeType?: string | null): boolean {
  return matchesAttachmentType(fileName, mimeType, XLSX_ATTACHMENT.mimeTypes, XLSX_ATTACHMENT.extensions);
}

function cellToString(cell: ExcelJS.Cell): string {
  let s: string;
  const v: unknown = cell.value;
  if (v === null || v === undefined) {
    s = "";
  } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    s = String(v);
  } else if (v instanceof Date) {
    s = v.toISOString();
  } else if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("richText" in obj && Array.isArray(obj["richText"])) {
      s = (obj["richText"] as Array<{ text?: string }>).map((p) => p.text ?? "").join("");
    } else if ("result" in obj && obj["result"] !== undefined && obj["result"] !== null) {
      s = String(obj["result"]);
    } else if ("text" in obj && typeof obj["text"] === "string") {
      s = obj["text"] as string;
    } else if ("hyperlink" in obj && typeof obj["hyperlink"] === "string") {
      s = String(obj["hyperlink"]);
    } else {
      try { s = JSON.stringify(v); } catch { s = ""; }
    }
  } else {
    s = String(v);
  }
  s = s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  if (s.length > MAX_CELL_CHARS) s = `${s.slice(0, MAX_CELL_CHARS)}…`;
  return s;
}

export async function xlsxBufferToMarkdown(buf: Buffer, fileName: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs's `Buffer` typedef predates @types/node's generic
    // Buffer<ArrayBufferLike> in TS 5.7. Both shapes work at runtime; cast
    // through unknown to satisfy the older signature.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buf as unknown as any);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `# ${fileName}\n\n_(failed to parse xlsx: ${msg})_\n`;
  }

  const out: string[] = [`# ${fileName}`, ""];
  const allSheets = wb.worksheets;
  const sheets = allSheets.slice(0, MAX_SHEETS);
  if (allSheets.length > MAX_SHEETS) {
    out.push(`_(${allSheets.length} sheets total; showing first ${MAX_SHEETS})_`);
    out.push("");
  }

  for (const ws of sheets) {
    const totalRows = ws.actualRowCount ?? ws.rowCount ?? 0;
    const totalCols = ws.actualColumnCount ?? ws.columnCount ?? 0;
    out.push(`## Sheet: ${ws.name} (${totalRows} rows × ${totalCols} cols)`);
    out.push("");

    const rowLimit = Math.min(totalRows, MAX_ROWS_PER_SHEET);
    const colLimit = Math.min(totalCols, MAX_COLS_PER_SHEET);
    if (rowLimit === 0 || colLimit === 0) {
      out.push("_(empty)_");
      out.push("");
      continue;
    }

    const rows: string[][] = [];
    for (let r = 1; r <= rowLimit; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= colLimit; c++) {
        cells.push(cellToString(row.getCell(c)));
      }
      rows.push(cells);
    }

    const header = rows[0] ?? [];
    out.push(`| ${header.join(" | ")} |`);
    out.push(`| ${header.map(() => "---").join(" | ")} |`);
    for (let i = 1; i < rows.length; i++) {
      out.push(`| ${(rows[i] ?? []).join(" | ")} |`);
    }

    if (totalRows > rowLimit || totalCols > colLimit) {
      out.push("");
      out.push(`_(truncated to ${rowLimit}×${colLimit} of ${totalRows}×${totalCols})_`);
    }
    out.push("");
  }

  return out.join("\n");
}
