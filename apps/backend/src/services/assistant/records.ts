import type { Candidate, EntityKind, EntityRef } from '@xyne/shared/assistant';

/**
 * Matches a spoken name to real records. The lookup itself is an adapter (see adapters.ts):
 * it runs inside the request, so the app's own rules decide what the user may see.
 */

/** A record that could match, with a line that tells it apart from namesakes (an email). */
export interface FoundRecord {
  record: EntityRef;
  detail?: string;
}

export interface RecordFinder {
  /** Records whose name could match `mention`, at most a few dozen. */
  find(kind: EntityKind, mention: string): Promise<FoundRecord[]>;
}

export type NameMatch =
  /** One clear record. `certain` when the name matched exactly, not just partly. */
  | { kind: 'one'; record: EntityRef; certain: boolean }
  /** Equally good matches; the user picks one. */
  | { kind: 'several'; candidates: Candidate[] }
  | { kind: 'none' };

/** Most records a "which one?" question offers. */
const MAX_CANDIDATES = 5;

/**
 * Ranks records against what the user said: the full name beats a first name or a whole
 * word, which beats part of a name. The best-ranked records win; a tie is a question.
 */
export function matchName(mention: string, found: readonly FoundRecord[]): NameMatch {
  const said = normalizeName(mention);
  if (!said) return { kind: 'none' };
  const scored = found
    .map(({ record, detail }) => ({ record, detail, score: nameScore(said, normalizeName(record.name)) }))
    .filter(({ score }) => score > 0);
  const best = Math.max(0, ...scored.map(({ score }) => score));
  const top = scored.filter(({ score }) => score === best);
  const [only] = top;
  if (!only) return { kind: 'none' };
  if (top.length === 1) return { kind: 'one', record: only.record, certain: best >= EXACT };
  return {
    kind: 'several',
    candidates: top.slice(0, MAX_CANDIDATES).map(({ record, detail }) => ({
      id: record.id,
      label: record.name,
      ...(detail ? { detail } : {}),
      value: record,
    })),
  };
}

/** The full name as said. */
const EXACT = 3;
/** Whole words of the name, such as a first name. */
const WORDS = 2;
/** Part of the name. */
const PART = 1;

function nameScore(said: string, name: string): number {
  if (said === name) return EXACT;
  const nameWords = name.split(' ');
  if (said.split(' ').every(word => nameWords.includes(word))) return WORDS;
  return name.includes(said) ? PART : 0;
}

/** "Release-Planning" and "release planning" are the same name. */
export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
