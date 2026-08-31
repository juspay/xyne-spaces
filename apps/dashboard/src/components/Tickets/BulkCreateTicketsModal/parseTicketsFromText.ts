/**
 * Parse a multi-line text block into a list of ticket titles.
 *
 * Items are separated by blank lines (double newlines) per the user's example
 * (`Go live tasks\n\nCode Hygiene\n\nTask 2`). If the text has no blank-line
 * separators, fall back to single-newline splitting so a plain list also works.
 * The first element is the parent ticket title; the rest are sub-ticket titles.
 */
export function parseTicketsFromText(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return [];

  let lines = normalized
    .split(/\n{2,}/)
    .map(s => s.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    lines = normalized
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  }
  return lines;
}
