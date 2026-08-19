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
