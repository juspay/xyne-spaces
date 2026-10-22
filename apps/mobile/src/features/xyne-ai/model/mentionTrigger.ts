export type MentionIndicator = '@' | '#';

export type MentionTrigger = { indicator: MentionIndicator; query: string; start: number };

const MAX_QUERY_LENGTH = 40;

const isIndicator = (char: string | undefined): char is MentionIndicator =>
  char === '@' || char === '#';

/** The "@" or "#" being typed at the cursor, if it starts the text or follows whitespace. */
export function activeMention(text: string, cursor: number): MentionTrigger | null {
  const limit = Math.max(0, cursor - MAX_QUERY_LENGTH - 1);
  for (let index = cursor - 1; index >= limit; index--) {
    const char = text[index];
    if (char === undefined || /\s/.test(char)) return null;
    if (isIndicator(char)) {
      if (index > 0 && !/\s/.test(text[index - 1] ?? '')) return null;
      return { indicator: char, query: text.slice(index + 1, cursor), start: index };
    }
  }
  return null;
}

export function insertMention(
  text: string,
  { indicator, start }: MentionTrigger,
  cursor: number,
  label: string,
): { text: string; cursor: number } {
  const inserted = `${indicator}${label} `;
  // The whole word being typed is replaced, even when the cursor sits inside it.
  const end = cursor + (/^\S*/.exec(text.slice(cursor))?.[0].length ?? 0);
  return {
    text: text.slice(0, start) + inserted + text.slice(end).trimStart(),
    cursor: start + inserted.length,
  };
}
