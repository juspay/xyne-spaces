import type { ClipboardEvent, KeyboardEvent } from 'react';
import type { FieldEnumOption } from '@xyne/shared';

export const MAX_FIELD_OPTIONS = 500;

export const parseBulkOptions = (raw: string): string[] =>
  raw
    .split(/[\r\n,;\t]+/)
    .map(option => option.trim())
    .filter(Boolean);

// Dedupes raw text against `existing` by value, preserving the id of anything already there
// and minting a fresh one only for genuinely new values.
const dedupeOptions = (
  values: string[],
  existing: FieldEnumOption[],
): { options: FieldEnumOption[]; duplicatesRemoved: number } => {
  const existingByValue = new Map(existing.map(option => [option.value, option]));
  const seen = new Set<string>();
  const result: FieldEnumOption[] = [];
  let duplicatesRemoved = 0;

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    if (seen.has(trimmed)) {
      duplicatesRemoved += 1;
      continue;
    }

    seen.add(trimmed);
    result.push(existingByValue.get(trimmed) ?? { id: crypto.randomUUID(), value: trimmed });
  }

  return { options: result, duplicatesRemoved };
};

export const createBulkOptionInputHandlers = (
  onAddOptions: (options: string[]) => void,
  clearInput?: () => void,
): {
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
} => ({
  onKeyDown: e => {
    if (e.key !== 'Enter') return;

    e.preventDefault();
    const target = e.currentTarget;
    const value = target.value;
    if (!value.trim()) return;

    onAddOptions([value.trim()]);
    if (clearInput) {
      clearInput();
    } else {
      target.value = '';
    }
  },
  onPaste: e => {
    const text = e.clipboardData.getData('text');
    const parsed = parseBulkOptions(text);
    if (parsed.length <= 1) return;

    e.preventDefault();
    onAddOptions(parsed);
    if (clearInput) {
      clearInput();
    } else {
      e.currentTarget.value = '';
    }
  },
});

/**
 * Rebuilds an option list from raw text (e.g. a bulk-edit textarea). Pass the list being
 * replaced as `existing` so values that survive unchanged keep their id.
 */
export const normalizeFieldOptions = (
  values: string[],
  existing: FieldEnumOption[] = [],
  maxCount = MAX_FIELD_OPTIONS,
): { options: FieldEnumOption[]; duplicatesRemoved: number; truncated: boolean } => {
  const { options: deduped, duplicatesRemoved } = dedupeOptions(values, existing);
  const truncated = deduped.length > maxCount;

  return {
    options: deduped.slice(0, maxCount),
    duplicatesRemoved,
    truncated,
  };
};

/** Adds raw incoming text to an existing option list, deduped and id-preserved. */
export const mergeFieldOptions = (
  existing: FieldEnumOption[],
  incoming: string[],
  maxCount = MAX_FIELD_OPTIONS,
): { options: FieldEnumOption[]; duplicatesRemoved: number; truncated: boolean } =>
  normalizeFieldOptions([...existing.map(option => option.value), ...incoming], existing, maxCount);

// An old option unmatched by a bulk edit, paired with the unmatched new lines that might be
// its new name — a candidate rename the caller has to actually decide on.
export type OptionRenameCandidate = {
  oldOption: FieldEnumOption;
  candidateValues: string[];
};

export type BulkOptionsResolution = {
  // Default: every unmatched old option dropped, every unmatched new value gets a fresh id.
  // Fine to use as-is unless something depends on one of the dropped options (renameCandidates).
  options: FieldEnumOption[];
  duplicatesRemoved: number;
  truncated: boolean;
  renameCandidates: OptionRenameCandidate[];
};

// Unlike normalizeFieldOptions, never guesses rename vs. delete+add — it reports every
// unmatched old option as a renameCandidate and leaves the decision to the caller.
export const resolveBulkOptions = (
  values: string[],
  existing: FieldEnumOption[],
  maxCount = MAX_FIELD_OPTIONS,
): BulkOptionsResolution => {
  const existingByValue = new Map(existing.map(option => [option.value, option]));
  const seen = new Set<string>();
  const claimedIds = new Set<string>();
  let duplicatesRemoved = 0;

  const trimmedValues: string[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(trimmed);
    trimmedValues.push(trimmed);

    const match = existingByValue.get(trimmed);
    if (match) claimedIds.add(match.id);
  }

  const truncated = trimmedValues.length > maxCount;
  const finalValues = trimmedValues.slice(0, maxCount);

  const unmatchedValues = finalValues.filter(value => !existingByValue.has(value));
  const unmatchedExisting = existing.filter(option => !claimedIds.has(option.id));

  const options = finalValues.map(
    value => existingByValue.get(value) ?? { id: crypto.randomUUID(), value },
  );

  const renameCandidates: OptionRenameCandidate[] = unmatchedExisting.map(oldOption => ({
    oldOption,
    candidateValues: unmatchedValues,
  }));

  return { options, duplicatesRemoved, truncated, renameCandidates };
};
