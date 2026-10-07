// How Buddy words what it says, shared by the engine and the turns it posts.

// A title said mid-sentence: "to send a message".
export const lowerFirst = (text: string): string =>
  `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

const MAX_QUOTED = 60;

// Words quoted back, cut short.
export const clip = (text: string): string =>
  text.length > MAX_QUOTED ? `${text.slice(0, MAX_QUOTED - 1)}…` : text;

// Words as compared, whatever their case or the spaces around them.
export const lower = (text: string): string => text.trim().toLowerCase();

// "A, B or C", "A, B and C": readable when spoken.
export const listOf = (labels: readonly string[], joiner: 'and' | 'or' = 'or'): string =>
  labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} ${joiner} ${labels.at(-1)}`
    : labels.join('');

// Sentences said one after another, the empty ones left out.
export const sentences = (...parts: string[]): string => parts.filter(Boolean).join(' ');
