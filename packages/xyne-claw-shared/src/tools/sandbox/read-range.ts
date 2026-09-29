export interface LineRange {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

export function hasRange(offset: unknown, limit: unknown): boolean {
  return positiveInt(offset) !== null || positiveInt(limit) !== null;
}

export function sliceLines(text: string, offset: unknown, limit: unknown): LineRange {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const startLine = positiveInt(offset) ?? 1;
  const count = positiveInt(limit) ?? totalLines;
  const slice = lines.slice(startLine - 1, startLine - 1 + count);
  return { content: slice.join("\n"), startLine, endLine: startLine - 1 + slice.length, totalLines };
}
