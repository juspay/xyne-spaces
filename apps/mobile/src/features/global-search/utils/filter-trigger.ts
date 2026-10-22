/** Parses dashboard-style `from:` / `in:` operators out of the raw field text. */

export type FilterTriggerKind = 'from' | 'in';
export type FilterInMode = 'all' | 'channels' | 'dms';

export type FilterTrigger = {
  kind: FilterTriggerKind;
  /** Text after the operator, with any leading `@` / `#` folded into `inMode`. */
  query: string;
  /** Index of `from:` / `in:` in the original text. */
  startIndex: number;
  inMode: FilterInMode;
};

const FROM_TRIGGER = /\bfrom:\s*(.*)$/i;
const IN_TRIGGER = /\bin:\s*(.*)$/i;

export function detectFilterTrigger(text: string): FilterTrigger | null {
  const fromMatch = text.match(FROM_TRIGGER);
  const inMatch = text.match(IN_TRIGGER);

  const fromIndex = fromMatch?.index ?? -1;
  const inIndex = inMatch?.index ?? -1;

  if (fromIndex < 0 && inIndex < 0) return null;

  // Whichever operator sits closest to the caret wins.
  if (fromIndex > inIndex && fromMatch) {
    return {
      kind: 'from',
      query: (fromMatch[1] ?? '').replace(/^@/, '').trim(),
      startIndex: fromIndex,
      inMode: 'all',
    };
  }

  if (inMatch && inIndex >= 0) {
    const raw = (inMatch[1] ?? '').trim();
    let inMode: FilterInMode = 'all';
    let query = raw;

    if (raw.startsWith('@')) {
      inMode = 'dms';
      query = raw.slice(1).trim();
    } else if (raw.startsWith('#')) {
      inMode = 'channels';
      query = raw.slice(1).trim();
    }

    return { kind: 'in', query, startIndex: inIndex, inMode };
  }

  return null;
}

/** Same suggestions, whatever else was typed before the operator. */
export function triggersEqual(a: FilterTrigger | null, b: FilterTrigger | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.kind === b.kind && a.query === b.query && a.inMode === b.inMode;
}

/** The part of the text that should reach Vespa — operators removed. */
export function toFreeText(text: string): string {
  const trigger = detectFilterTrigger(text);
  return trigger ? text.slice(0, trigger.startIndex).trim() : text.trim();
}

/** Drops the half-typed operator once its chip has been committed. */
export function stripActiveTrigger(text: string): string {
  const trigger = detectFilterTrigger(text);
  return trigger ? text.slice(0, trigger.startIndex).replace(/\s+$/, '') : text;
}
