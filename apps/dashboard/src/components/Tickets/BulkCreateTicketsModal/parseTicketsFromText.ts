/**
 * Parse a composer draft into one ticket per blank-line-separated block.
 *
 * Only a blank line starts a new ticket. A single newline stays inside the
 * block it belongs to, so an ordinary multi-line description stays one ticket
 * ("Login fails on Safari\nSteps: …" is not two tickets). Within a block the
 * first line is the title and whatever follows is its description, so nothing
 * the user typed is dropped on the way into the bulk modal.
 */
export interface ParsedTicketDraft {
  title: string;
  description: string;
}

export function parseTicketsFromText(text: string): ParsedTicketDraft[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (!normalized) return [];

  return normalized
    .split(/\n[ \t]*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const [firstLine = '', ...rest] = block.split('\n');
      return { title: firstLine.trim(), description: rest.join('\n').trim() };
    })
    .filter(draft => draft.title.length > 0);
}
