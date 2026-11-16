/**
 * Markdown → what a Teams message renders (sent with textFormat "markdown").
 *
 * Teams renders bold, italic, strikethrough, inline code, fenced code, links,
 * bullet and numbered lists and block quotes as written. What it does not
 * render well is changed:
 *  - headings  → a bold line (Teams shows "#" headings inconsistently across
 *                desktop, web and mobile);
 *  - tables    → a fenced block, so the columns still line up (pipe tables
 *                arrive as raw pipes);
 *  - rules     → dropped (rendered as a literal line of dashes);
 *  - task list → ☐ / ☑ bullets;
 *  - a single newline inside a paragraph → a hard break, because Teams joins
 *    such lines into one, which runs a short list of lines together.
 */
export function formatForTeams(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  let table: string[] = [];

  const flushTable = () => {
    if (table.length === 0) return;
    const rows = table.filter((row) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row));
    out.push("```", ...rows.map((row) => row.trim()), "```");
    table = [];
  };

  for (const rawLine of lines) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      flushTable();
      inFence = !inFence;
      out.push(rawLine.replace(/^(\s*)~~~/, "$1```"));
      continue;
    }
    if (inFence) {
      out.push(rawLine);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(rawLine)) {
      table.push(rawLine);
      continue;
    }
    flushTable();
    let line = rawLine;
    line = line.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/, (_m, title: string) => `**${title.trim()}**`);
    line = line.replace(/^(\s*)[-*+]\s+\[( |x|X)\]\s+/, (_m, indent: string, mark: string) => `${indent}- ${mark.trim() ? "☑" : "☐"} `);
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) continue;
    out.push(line);
  }
  flushTable();
  if (inFence) out.push("```");

  return hardBreaks(out).replace(/\n{3,}/g, "\n\n").trim();
}

const BLOCK_START = /^\s*(?:[-*+]\s|\d+[.)]\s|>|```)/;

/** Join lines, turning a lone newline between two prose lines into a
 *  markdown hard break ("  \n"). Lists, quotes, fences and blank-line
 *  paragraph breaks are left as they are. */
function hardBreaks(lines: string[]): string {
  let inFence = false;
  let result = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i > 0) {
      const prev = lines[i - 1]!;
      const prose = !inFence && prev.trim() !== "" && line.trim() !== "" && !BLOCK_START.test(line) && !BLOCK_START.test(prev);
      result += prose ? "  \n" : "\n";
    }
    result += line;
    if (/^\s*```/.test(line)) inFence = !inFence;
  }
  return result;
}
