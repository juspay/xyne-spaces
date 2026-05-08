/**
 * Parse a CSV file that maps slide identifiers to URLs.
 *
 */
export function parseSlideUrlCsv(buffer: Buffer): Record<string, string> {
  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const result: Record<string, string> = {};

  for (const line of lines) {
    // Find the first comma — everything before is the key, everything after is the URL
    const commaIdx = line.indexOf(',');
    if (commaIdx === -1) continue;

    const key = line.slice(0, commaIdx).trim().replace(/^"|"$/g, '');
    const value = line.slice(commaIdx + 1).trim().replace(/^"|"$/g, '');

    if (!key || !value) continue;

    // Skip a header row (case-insensitive)
    if (key.toLowerCase() === 'slide' || key.toLowerCase() === 'slide_number') continue;

    result[key] = value;
  }

  return result;
}
