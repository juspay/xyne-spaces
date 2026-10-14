/**
 * Step text may embed `[[IconKey]]` tokens (the same convention as the
 * dashboard guide) which render as small boxed glyphs inline, so a step can
 * show the exact button the user is looking for.
 */

const TOKEN_PATTERN = /(\[\[[^\]]+\]\])/g;
const TOKEN_MATCH = /^\[\[([^\]]+)\]\]$/;

export type StepSegment = { type: 'text'; value: string } | { type: 'icon'; value: string };

export function parseStepTokens(text: string): StepSegment[] {
  const segments: StepSegment[] = [];
  for (const part of text.split(TOKEN_PATTERN)) {
    if (part.length === 0) continue;
    const match = TOKEN_MATCH.exec(part);
    if (match?.[1]) {
      segments.push({ type: 'icon', value: match[1] });
    } else {
      segments.push({ type: 'text', value: part });
    }
  }
  return segments;
}

/** Every icon key referenced by a step, for catalog validation. */
export function extractStepIconKeys(text: string): string[] {
  return parseStepTokens(text)
    .filter((segment): segment is { type: 'icon'; value: string } => segment.type === 'icon')
    .map(segment => segment.value);
}

/** Plain-text form for search indexing and accessibility labels. */
export function stripStepTokens(text: string): string {
  return parseStepTokens(text)
    .map(segment => (segment.type === 'text' ? segment.value : segment.value))
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
