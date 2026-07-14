/**
 * OOXML (Office Open XML) readers for .xlsx / .docx / .pptx.
 *
 * Replaces the old hand-rolled `parseXlsxBuffer` in drive.ts, which silently:
 *   - emitted date cells as raw serial numbers (46023) with no conversion,
 *   - corrupted the shared-strings index on any rich-text (multi-run) cell,
 *   - dropped inline-string cells and sheet names, and
 *   - ignored cell column references, so sparse rows misaligned.
 *
 * This module handles all of the above per ECMA-376:
 *   - ZIP read via the central directory (robust to data-descriptor entries),
 *   - shared strings concatenated per <si> (rich-text safe), entities decoded,
 *   - styles.xml numFmt → date detection, serial → ISO date conversion
 *     (1900 & 1904 date systems), and
 *   - cell `r` refs honored so columns line up; real sheet names + tab order
 *     resolved from workbook.xml + its rels.
 *
 * Everything is dependency-free (only node:zlib). Readers return `undefined`
 * when the buffer isn't a parseable archive, so callers can fall back.
 */

import { inflateRawSync } from "zlib";

// ── ZIP (central-directory based) ────────────────────────────────────

/** Read every entry of a ZIP archive into a name→Buffer map. */
export function unzip(buffer: Buffer): Map<string, Buffer> | undefined {
  const out = new Map<string, Buffer>();
  // Locate End Of Central Directory (scan back for its signature).
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
    if (buffer.length - i > 65_557) break; // EOCD comment max 64KB
  }
  if (eocd < 0) return undefined;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16); // central directory offset

  for (let e = 0; e < entryCount; e++) {
    if (ptr + 46 > buffer.length || buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(ptr + 10);
    const compSize = buffer.readUInt32LE(ptr + 20);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf-8");

    // Jump to the local header to find where the data actually starts.
    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = buffer.subarray(dataStart, dataStart + compSize);
      try {
        if (method === 0) out.set(name, Buffer.from(raw));
        else if (method === 8) out.set(name, inflateRawSync(raw));
      } catch {
        // skip unreadable entry
      }
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out.size > 0 ? out : undefined;
}

// ── XML helpers ──────────────────────────────────────────────────────

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, ent: string) => {
    switch (ent) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        if (ent[0] === "#") {
          const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return m;
    }
  });
}

/** All text inside every <t>…</t> (or a chosen tag), concatenated & decoded. */
function textOfTag(xml: string, tag: string): string {
  let out = "";
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  for (const m of xml.matchAll(re)) out += decodeXmlEntities(m[1] ?? "");
  return out;
}

// ── Excel serial dates ───────────────────────────────────────────────

/**
 * Convert an Excel serial number to an ISO date (or date-time) string.
 * Uses the Unix-epoch anchor (serial 25569 = 1970-01-01 in the 1900 system),
 * which yields correct dates for all real-world (post-1900-03-01) values and
 * sidesteps the Excel 1900-leap-year bug.
 */
export function excelSerialToDate(serial: number, date1904 = false): string {
  const epochSerial = date1904 ? 24107 : 25569; // serial of 1970-01-01
  const ms = Math.round((serial - epochSerial) * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  const hasTime = Math.abs(serial - Math.trunc(serial)) > 1e-9;
  return hasTime ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10);
}

// Builtin numFmt ids that are date/time formats (ECMA-376 §18.8.30).
const BUILTIN_DATE_FMTS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56,
  57, 58,
]);

/** Does a custom number-format code denote a date/time? (y/m/d/h/s tokens.) */
function isDateFormatCode(code: string): boolean {
  // Strip literals in quotes, escaped chars, [colors]/[conditions], and the
  // currency/locale bracket, then look for date tokens.
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /[ymdhs]/i.test(stripped);
}

/**
 * From styles.xml, build a predicate: does cell style index `s` format a date?
 * Maps cellXfs[s].numFmtId → builtin/custom date detection.
 */
function buildDateStyleTest(stylesXml: string | undefined): (styleIdx: number | undefined) => boolean {
  if (!stylesXml) return () => false;

  // Custom numFmts: id → format code.
  const customDate = new Map<number, boolean>();
  const numFmtsBlock = stylesXml.match(/<numFmts[\s\S]*?<\/numFmts>/)?.[0] ?? "";
  for (const m of numFmtsBlock.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/?>/g)) {
    customDate.set(parseInt(m[1]!, 10), isDateFormatCode(decodeXmlEntities(m[2] ?? "")));
  }

  // cellXfs: ordered list of numFmtId per style index.
  const xfBlock = stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? "";
  const numFmtIds: number[] = [];
  for (const m of xfBlock.matchAll(/<xf\b[^>]*>/g)) {
    const id = m[0].match(/numFmtId="(\d+)"/);
    numFmtIds.push(id ? parseInt(id[1]!, 10) : 0);
  }

  return (styleIdx) => {
    if (styleIdx == null) return false;
    const numFmtId = numFmtIds[styleIdx];
    if (numFmtId == null) return false;
    if (BUILTIN_DATE_FMTS.has(numFmtId)) return true;
    return customDate.get(numFmtId) ?? false;
  };
}

// ── Shared strings ───────────────────────────────────────────────────

/** Parse sharedStrings.xml → array of strings, concatenating runs per <si>. */
function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push(textOfTag(si[1] ?? "", "t"));
  }
  return out;
}

// ── Cell refs ────────────────────────────────────────────────────────

/** "B12" → column index 1 (0-based). */
function colIndexOf(ref: string): number {
  const m = ref.match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ── Worksheet parsing ────────────────────────────────────────────────

interface CellValue {
  col: number;
  text: string;
}

function parseSheet(
  xml: string,
  sharedStrings: string[],
  isDateStyle: (s: number | undefined) => boolean,
  date1904: boolean,
): string[][] {
  const rowsOut: string[][] = [];
  let expectedRow = 1;

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttrs = rowMatch[1] ?? "";
    const rowNum = parseInt(rowAttrs.match(/\br="(\d+)"/)?.[1] ?? String(expectedRow), 10);
    // Insert blank rows for gaps so vertical position is preserved.
    while (expectedRow < rowNum) {
      rowsOut.push([]);
      expectedRow++;
    }
    expectedRow = rowNum + 1;

    const cells: CellValue[] = [];
    const body = rowMatch[2] ?? "";
    // Match both <c .../> (empty) and <c ...>…</c>.
    for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? "";
      const inner = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const col = ref ? colIndexOf(ref) : cells.length;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const styleIdx = attrs.match(/\bs="(\d+)"/)?.[1];
      const s = styleIdx != null ? parseInt(styleIdx, 10) : undefined;

      let text = "";
      if (type === "inlineStr") {
        text = textOfTag(inner, "t");
      } else if (type === "s") {
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        const idx = parseInt(decodeXmlEntities(raw), 10);
        text = sharedStrings[idx] ?? "";
      } else if (type === "str") {
        text = decodeXmlEntities(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      } else if (type === "b") {
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        text = raw.trim() === "1" ? "TRUE" : "FALSE";
      } else {
        // numeric (t absent or "n"), or error ("e")
        const raw = decodeXmlEntities(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        if (raw !== "" && type !== "e" && isDateStyle(s)) {
          const num = Number(raw);
          text = Number.isFinite(num) ? excelSerialToDate(num, date1904) : raw;
        } else {
          text = raw;
        }
      }
      cells.push({ col, text });
    }

    if (cells.length === 0) {
      rowsOut.push([]);
      continue;
    }
    const width = Math.max(...cells.map((c) => c.col)) + 1;
    const row = new Array<string>(width).fill("");
    for (const c of cells) row[c.col] = c.text;
    rowsOut.push(row);
  }

  // Trim trailing all-empty rows.
  while (rowsOut.length > 0 && rowsOut[rowsOut.length - 1]!.every((c) => c === "")) rowsOut.pop();
  return rowsOut;
}

// ── Public XLSX API ──────────────────────────────────────────────────

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

/** Parse an .xlsx buffer into named sheets of string cells. */
export function parseXlsx(buffer: Buffer): XlsxSheet[] | undefined {
  const zip = unzip(buffer);
  if (!zip) return undefined;

  const sharedStrings = parseSharedStrings(zip.get("xl/sharedStrings.xml")?.toString("utf-8"));
  const stylesXml = zip.get("xl/styles.xml")?.toString("utf-8");
  const isDateStyle = buildDateStyleTest(stylesXml);

  const workbookXml = zip.get("xl/workbook.xml")?.toString("utf-8") ?? "";
  const date1904 = /date1904="(1|true)"/i.test(workbookXml);

  // Resolve tab order + names via workbook.xml → rels → worksheet target.
  const relsXml = zip.get("xl/_rels/workbook.xml.rels")?.toString("utf-8") ?? "";
  const relTarget = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g)) {
    relTarget.set(m[1]!, m[2]!.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }

  const ordered: Array<{ name: string; path: string }> = [];
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1] ?? "";
    const name = decodeXmlEntities(attrs.match(/\bname="([^"]*)"/)?.[1] ?? `Sheet${ordered.length + 1}`);
    const rid = attrs.match(/r:id="([^"]+)"/)?.[1];
    const target = rid ? relTarget.get(rid) : undefined;
    const path = target ? `xl/${target}` : "";
    ordered.push({ name, path });
  }

  // Fallback: no workbook metadata → enumerate sheetN.xml in order.
  if (ordered.length === 0) {
    for (let i = 1; i <= 200; i++) {
      const path = `xl/worksheets/sheet${i}.xml`;
      if (!zip.has(path)) break;
      ordered.push({ name: `Sheet${i}`, path });
    }
  }

  const sheets: XlsxSheet[] = [];
  for (const { name, path } of ordered) {
    const sheetXml = zip.get(path)?.toString("utf-8");
    if (!sheetXml) continue;
    sheets.push({ name, rows: parseSheet(sheetXml, sharedStrings, isDateStyle, date1904) });
  }
  return sheets.length > 0 ? sheets : undefined;
}

function csvEscape(cell: string): string {
  return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Render an .xlsx buffer as CSV-like text with real sheet-name headers. */
export function xlsxToText(buffer: Buffer): string | undefined {
  const sheets = parseXlsx(buffer);
  if (!sheets) return undefined;
  return sheets
    .map((s) => {
      const body = s.rows.length > 0 ? s.rows.map((r) => r.map(csvEscape).join(",")).join("\n") : "(empty)";
      return `--- Sheet: ${s.name} ---\n${body}`;
    })
    .join("\n\n");
}

// ── DOCX ─────────────────────────────────────────────────────────────

/** Extract readable text from a .docx buffer (paragraphs, tabs, breaks, tables). */
export function docxToText(buffer: Buffer): string | undefined {
  const zip = unzip(buffer);
  const xml = zip?.get("word/document.xml")?.toString("utf-8");
  if (!xml) return undefined;
  const body = xml.match(/<w:body>([\s\S]*?)<\/w:body>/)?.[1] ?? xml;

  // Normalize structural markers to text, then pull <w:t> content in order.
  const normalized = body
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:tc>/g, "\t");

  let out = "";
  for (const m of normalized.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|(\n|\t)/g)) {
    if (m[1] != null) out += decodeXmlEntities(m[1]);
    else if (m[2]) out += m[2];
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── PPTX ─────────────────────────────────────────────────────────────

/** Extract text from a .pptx buffer, per slide, including speaker notes. */
export function pptxToText(buffer: Buffer): string | undefined {
  const zip = unzip(buffer);
  if (!zip) return undefined;

  const slidePaths = [...zip.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => slideNum(a) - slideNum(b));
  if (slidePaths.length === 0) return undefined;

  const parts: string[] = [];
  for (const path of slidePaths) {
    const n = slideNum(path);
    const text = textOfTag(zip.get(path)!.toString("utf-8"), "a:t");
    const notesXml = zip.get(`ppt/notesSlides/notesSlide${n}.xml`)?.toString("utf-8");
    const notes = notesXml ? textOfTag(notesXml, "a:t") : "";
    let block = `--- Slide ${n} ---\n${text}`;
    if (notes.trim()) block += `\n[Speaker notes] ${notes}`;
    parts.push(block);
  }
  return parts.join("\n\n");
}

function slideNum(path: string): number {
  return parseInt(path.match(/(\d+)\.xml$/)?.[1] ?? "0", 10);
}
