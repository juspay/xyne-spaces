/** Run errors often carry Prisma's ANSI colour codes; they are noise anywhere they are shown. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * A one-line summary of a possibly multi-line error. Multi-line errors (Prisma
 * especially) open with "Invalid `prisma.x()` invocation" and put the actual
 * cause on the LAST line, so both ends are kept: "first … last".
 */
export function summarizeError(raw: string, max = 300): string {
  const lines = stripAnsi(raw)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const text = lines.length > 1 ? `${lines[0]} … ${lines[lines.length - 1]}` : (lines[0] ?? "");
  const oneLine = text.replace(/\s+/g, " ");
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
