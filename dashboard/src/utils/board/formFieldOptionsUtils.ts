import type { ClipboardEvent, KeyboardEvent } from 'react';

export const MAX_FIELD_OPTIONS = 500;

export const parseBulkOptions = (raw: string): string[] =>
  raw
    .split(/[\r\n,;\t]+/)
    .map(option => option.trim())
    .filter(Boolean);

const dedupeOptions = (options: string[]): { options: string[]; duplicatesRemoved: number } => {
  const seen = new Set<string>();
  const result: string[] = [];
  let duplicatesRemoved = 0;

  for (const option of options) {
    const trimmed = option.trim();
    if (!trimmed) continue;

    if (seen.has(trimmed)) {
      duplicatesRemoved += 1;
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
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

export const normalizeFieldOptions = (
  options: string[],
  maxCount = MAX_FIELD_OPTIONS,
): { options: string[]; duplicatesRemoved: number; truncated: boolean } => {
  const { options: deduped, duplicatesRemoved } = dedupeOptions(options);
  const truncated = deduped.length > maxCount;

  return {
    options: deduped.slice(0, maxCount),
    duplicatesRemoved,
    truncated,
  };
};

export const mergeFieldOptions = (
  existing: string[],
  incoming: string[],
  maxCount = MAX_FIELD_OPTIONS,
): { options: string[]; duplicatesRemoved: number; truncated: boolean } =>
  normalizeFieldOptions([...existing, ...incoming], maxCount);
