/**
 * Google Docs API helpers — create documents and append text.
 * Requires scope: https://www.googleapis.com/auth/documents
 */

import { googleFetch } from "./oauth.js";

const BASE = "https://docs.googleapis.com/v1";
const MAX_DOCS_TEXT_CHARS = 100_000;

interface DocumentResponse {
  documentId: string;
  title?: string;
  body?: {
    content?: StructuralElement[];
  };
}

interface StructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: {
    elements?: ParagraphElement[];
    paragraphStyle?: {
      namedStyleType?: string; // "HEADING_1", "HEADING_2", "NORMAL_TEXT", etc.
      alignment?: string;      // "START", "CENTER", "END", "JUSTIFIED"
    };
  };
  table?: Table;          // table content — now recursed by readDocument (was dropped)
  sectionBreak?: unknown; // skip for now
}

/**
 * Google Docs table shape (documents#Table / TableRow / TableCell).
 * A table is rows -> cells, and each cell's `content` is ITSELF an array of
 * StructuralElement (paragraphs and, rarely, nested tables) — so extracting
 * cell text requires recursion, exactly like the top-level body.content walk.
 */
interface Table {
  rows?: number;
  columns?: number;
  tableRows?: TableRow[];
}

interface TableRow {
  startIndex?: number;
  endIndex?: number;
  tableCells?: TableCell[];
}

interface TableCell {
  startIndex?: number;
  endIndex?: number;
  content?: StructuralElement[]; // recursive: same shape as body.content
}

interface ParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: {
    content?: string;
    textStyle?: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strikethrough?: boolean;
      weightedFontFamily?: { fontFamily?: string; weight?: number };
      fontSize?: { magnitude?: number; unit?: string };
      foregroundColor?: { color?: { rgbColor?: { red?: number; green?: number; blue?: number } } };
    };
  };
}



export interface TextStyleUpdate {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontFamily?: string;
  fontSize?: number; // in pt
  foregroundColor?: { red?: number; green?: number; blue?: number }; // 0.0 - 1.0
}

export interface ParagraphStyleUpdate {
  namedStyleType?: string; // "HEADING_1", "HEADING_2", "HEADING_3", "NORMAL_TEXT", etc.
  alignment?: string;      // "START", "CENTER", "END", "JUSTIFIED"
  spaceAbove?: number;     // in pt
  spaceBelow?: number;     // in pt
}


/** Create a new Google Doc, optionally seeded with body text. */
export async function createDocument(token: string, title: string, body?: string): Promise<string> {
  if (!title.trim()) throw new Error("Document title cannot be empty");
  if (body && body.length > MAX_DOCS_TEXT_CHARS) {
    throw new Error(`Document body too large. Max ${MAX_DOCS_TEXT_CHARS} characters.`);
  }
  const created = (await googleFetch(`${BASE}/documents`, token, {
    method: "POST",
    body: JSON.stringify({ title }),
  })) as DocumentResponse;

  if (body && body.length > 0) {
    await googleFetch(`${BASE}/documents/${encodeURIComponent(created.documentId)}:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: 1 }, text: body } }],
      }),
    });
  }
  return [
    `Document created: ${title}`,
    `Document ID: ${created.documentId}`,
    `URL: https://docs.google.com/document/d/${created.documentId}/edit`,
  ].join("\n");
}

/** Append text to an existing Google Doc (at the end of the body). */
export async function appendToDocument(token: string, documentId: string, text: string): Promise<string> {
  if (!documentId.trim()) throw new Error("documentId is required");
  if (!text.trim()) throw new Error("text cannot be empty");
  if (text.length > MAX_DOCS_TEXT_CHARS) {
    throw new Error(`Append text too large. Max ${MAX_DOCS_TEXT_CHARS} characters.`);
  }
  const doc = (await googleFetch(`${BASE}/documents/${encodeURIComponent(documentId)}`, token)) as DocumentResponse;
  const last = doc.body?.content ?? [];
  // endIndex of last structural element is the doc end. Insert just before it.
  const endIndex = last.length > 0 ? (last[last.length - 1]?.endIndex ?? 1) - 1 : 1;
  await googleFetch(`${BASE}/documents/${encodeURIComponent(documentId)}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ insertText: { location: { index: Math.max(1, endIndex) }, text } }],
    }),
  });
  return `Appended ${text.length} chars to document ${documentId}`;
}

/** Concatenate the raw text of a paragraph's textRun elements. */
function paragraphText(paragraph: NonNullable<StructuralElement["paragraph"]>): string {
  let text = "";
  for (const run of paragraph.elements ?? []) {
    // Only textRun carries text; inline objects / page breaks / smart-chips have
    // no `.content` and are simply skipped (they never crashed, just no text).
    if (run.textRun?.content) text += run.textRun.content;
  }
  return text;
}

/**
 * Extract readable text from a table cell's `content` array. A cell holds
 * paragraphs and, rarely, nested tables — recurse so no inner cell text is
 * dropped. Newlines are collapsed so one cell renders on one line.
 */
function cellText(content: StructuralElement[] | undefined): string {
  const parts: string[] = [];
  for (const element of content ?? []) {
    if (element.paragraph) {
      const t = paragraphText(element.paragraph).replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    } else if (element.table) {
      // Nested table inside a cell: recurse so its cell text is preserved too.
      const nested = tableRowsText(element.table)
        .map((row) => row.join(" | "))
        .join(" ; ");
      if (nested) parts.push(`[table: ${nested}]`);
    }
  }
  return parts.join(" ");
}

/** Build a 2-D array (rows -> cells) of extracted cell text for a table. */
function tableRowsText(table: Table): string[][] {
  const rows: string[][] = [];
  // table.tableRows[].tableCells[].content[] — the path readDocument used to skip.
  for (const row of table.tableRows ?? []) {
    const cells: string[] = [];
    for (const cell of row.tableCells ?? []) {
      cells.push(cellText(cell.content));
    }
    rows.push(cells);
  }
  return rows;
}

/** Read a document's structural content with index positions. */
export async function readDocument(token: string, documentId: string): Promise<string> {
  if (!documentId.trim()) throw new Error("documentId is required");

  const doc = (await googleFetch(
    `${BASE}/documents/${encodeURIComponent(documentId)}`,
    token,
  )) as DocumentResponse;

  const lines: string[] = [];
  lines.push(`Title: ${doc.title ?? "Untitled"}`);
  lines.push(`Document ID: ${documentId}`);
  lines.push("");

  // Walk through structural elements to extract text with index ranges
  for (const element of doc.body?.content ?? []) {
    if (element.paragraph) {
      const para = element.paragraph;
      for (const run of para.elements ?? []) {
        if (run.textRun?.content) {
          const start = run.startIndex ?? 0;
          const end = run.endIndex ?? 0;
          const text = run.textRun.content;
          const style = run.textRun.textStyle;
          const formatting: string[] = [];
          if (style?.bold) formatting.push("bold");
          if (style?.italic) formatting.push("italic");
          if (style?.underline) formatting.push("underline");
          if (style?.strikethrough) formatting.push("strikethrough");
          if (style?.weightedFontFamily?.fontFamily) formatting.push(`font:${style.weightedFontFamily.fontFamily}`);
          if (style?.fontSize?.magnitude) formatting.push(`size:${style.fontSize.magnitude}pt`);

          const fmt = formatting.length > 0 ? ` [${formatting.join(", ")}]` : "";
          // Keep the [start-end] range annotation — downstream edit tools depend on it.
          lines.push(`[${start}-${end}]${fmt} ${JSON.stringify(text)}`);
        }
      }
    } else if (element.table) {
      // Tables were previously dropped ("skip for now"). Recurse
      // table.tableRows[].tableCells[].content[] and render each row readably
      // (cells joined by " | ") so no cell text is lost.
      const start = element.startIndex ?? 0;
      const end = element.endIndex ?? 0;
      lines.push(`[${start}-${end}] [Table]`);
      for (const row of tableRowsText(element.table)) {
        lines.push(row.join(" | "));
      }
    }
  }

  return lines.join("\n");
}

/** Find and replace text across the entire document. */
export async function replaceAllText(
  token: string,
  documentId: string,
  findText: string,
  replaceText: string,
  matchCase: boolean = true,
): Promise<string> {
  if (!documentId.trim()) throw new Error("documentId is required");
  if (!findText) throw new Error("findText cannot be empty");

  const result = (await googleFetch(
    `${BASE}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            replaceAllText: {
              containsText: { text: findText, matchCase },
              replaceText,
            },
          },
        ],
      }),
    },
  )) as { replies?: Array<{ replaceAllText?: { occurrencesChanged?: number } }> };

  const changed = result.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
  return `Replaced ${changed} occurrence(s) of "${findText}" with "${replaceText}" in document ${documentId}`;
}

/** Insert text at a specific index position in the document. */
export async function insertTextAt(
  token: string,
  documentId: string,
  index: number,
  text: string,
): Promise<string> {
  if (!documentId.trim()) throw new Error("documentId is required");
  if (index < 1) throw new Error("index must be >= 1");
  if (!text) throw new Error("text cannot be empty");
  if (text.length > MAX_DOCS_TEXT_CHARS) {
    throw new Error(`Text too large. Max ${MAX_DOCS_TEXT_CHARS} characters.`);
  }

  await googleFetch(
    `${BASE}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          { insertText: { location: { index }, text } },
        ],
      }),
    },
  );

  return `Inserted ${text.length} chars at index ${index} in document ${documentId}`;
}

/** Delete text between startIndex and endIndex in the document. */
export async function deleteRange(
  token: string,
  documentId: string,
  startIndex: number,
  endIndex: number,
): Promise<string> {
  if (!documentId.trim()) throw new Error("documentId is required");
  if (startIndex < 1) throw new Error("startIndex must be >= 1");
  if (endIndex <= startIndex) throw new Error("endIndex must be > startIndex");

  await googleFetch(
    `${BASE}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          { deleteContentRange: { range: { startIndex, endIndex } } },
        ],
      }),
    },
  );

  return `Deleted text at range [${startIndex}-${endIndex}] (${endIndex - startIndex} chars) in document ${documentId}`;
}

/** Replace text at a specific range (delete + insert in one batch). */
export async function replaceRange(
  token: string,
  documentId: string,
  startIndex: number,
  endIndex: number,
  newText: string,
): Promise<string> {
  if (!documentId.trim()) throw new Error("documentId is required");
  if (startIndex < 1) throw new Error("startIndex must be >= 1");
  if (endIndex <= startIndex) throw new Error("endIndex must be > startIndex");
  if (newText.length > MAX_DOCS_TEXT_CHARS) {
    throw new Error(`Text too large. Max ${MAX_DOCS_TEXT_CHARS} characters.`);
  }

  // Order matters: delete first, then insert at the same startIndex.
  // After deletion, indices shift, but insertText at the original startIndex
  // is still correct because the deletion happened at that position.
  // However, the Google Docs API processes requests sequentially,
  // so after deleting [startIndex, endIndex), the insert at startIndex
  // refers to the NEW index after the shift.
  // We need to insert at startIndex (which hasn't moved because we deleted forward).
  await googleFetch(
    `${BASE}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          { deleteContentRange: { range: { startIndex, endIndex } } },
          { insertText: { location: { index: startIndex }, text: newText } },
        ],
      }),
    },
  );

  return `Replaced range [${startIndex}-${endIndex}] with ${newText.length} chars in document ${documentId}`;
}

/** Apply text formatting (bold, italic, font, etc.) to a range in the document. */
export async function updateTextStyle(
  token: string,
  documentId: string,
  startIndex: number,
  endIndex: number,
  style: TextStyleUpdate,
): Promise<string> {
  if (!documentId.trim()) throw new Error("documentId is required");
  if (startIndex < 1) throw new Error("startIndex must be >= 1");
  if (endIndex <= startIndex) throw new Error("endIndex must be > startIndex");

  const textStyle: Record<string, unknown> = {};
  const fields: string[] = [];

  if (style.bold !== undefined) { textStyle.bold = style.bold; fields.push("bold"); }
  if (style.italic !== undefined) { textStyle.italic = style.italic; fields.push("italic"); }
  if (style.underline !== undefined) { textStyle.underline = style.underline; fields.push("underline"); }
  if (style.strikethrough !== undefined) { textStyle.strikethrough = style.strikethrough; fields.push("strikethrough"); }
  if (style.fontFamily !== undefined) {
    textStyle.weightedFontFamily = { fontFamily: style.fontFamily };
    fields.push("weightedFontFamily");
  }
  if (style.fontSize !== undefined) {
    textStyle.fontSize = { magnitude: style.fontSize, unit: "PT" };
    fields.push("fontSize");
  }
  if (style.foregroundColor !== undefined) {
    textStyle.foregroundColor = { color: { rgbColor: style.foregroundColor } };
    fields.push("foregroundColor");
  }

  if (fields.length === 0) throw new Error("At least one style property must be specified");

  await googleFetch(
    `${BASE}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateTextStyle: {
              range: { startIndex, endIndex },
              textStyle,
              fields: fields.join(","),
            },
          },
        ],
      }),
    },
  );

  return `Applied ${fields.join(", ")} formatting to range [${startIndex}-${endIndex}] in document ${documentId}`;
}


/** Apply paragraph formatting (heading style, alignment, spacing) to a range. */
export async function updateParagraphStyle(
  token: string,
  documentId: string,
  startIndex: number,
  endIndex: number,
  style: ParagraphStyleUpdate,
): Promise<string> {
  if (!documentId.trim()) throw new Error("documentId is required");
  if (startIndex < 1) throw new Error("startIndex must be >= 1");
  if (endIndex <= startIndex) throw new Error("endIndex must be > startIndex");

  const paragraphStyle: Record<string, unknown> = {};
  const fields: string[] = [];

  if (style.namedStyleType !== undefined) {
    paragraphStyle.namedStyleType = style.namedStyleType;
    fields.push("namedStyleType");
  }
  if (style.alignment !== undefined) {
    paragraphStyle.alignment = style.alignment;
    fields.push("alignment");
  }
  if (style.spaceAbove !== undefined) {
    paragraphStyle.spaceAbove = { magnitude: style.spaceAbove, unit: "PT" };
    fields.push("spaceAbove");
  }
  if (style.spaceBelow !== undefined) {
    paragraphStyle.spaceBelow = { magnitude: style.spaceBelow, unit: "PT" };
    fields.push("spaceBelow");
  }

  if (fields.length === 0) throw new Error("At least one paragraph style property must be specified");

  await googleFetch(
    `${BASE}/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateParagraphStyle: {
              range: { startIndex, endIndex },
              paragraphStyle,
              fields: fields.join(","),
            },
          },
        ],
      }),
    },
  );

  return `Applied paragraph ${fields.join(", ")} to range [${startIndex}-${endIndex}] in document ${documentId}`;
}

