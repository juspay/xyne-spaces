/**
 * Call.markedItems holds three kinds of entry in one array: `decision` and `action`
 * are extracted by the post-call summary pipeline, `moment` is flagged by the user
 * during the recording. The column is untyped JSON on the client, so every field is
 * checked before use.
 */

export type MarkedItemType = 'decision' | 'action' | 'moment';

export interface MarkedItem {
  type: MarkedItemType;
  /** One-line description; empty for moments marked before any transcript line. */
  text: string;
  /** Offset into the recording, measured from the first transcript line. */
  timestampSeconds: number;
}

const MARKED_ITEM_TYPES = new Set<string>(['decision', 'action', 'moment']);

const isMarkedItem = (item: unknown): item is MarkedItem => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;

  const candidate = item as { type?: unknown; text?: unknown; timestampSeconds?: unknown };
  return (
    typeof candidate.type === 'string' &&
    MARKED_ITEM_TYPES.has(candidate.type) &&
    typeof candidate.timestampSeconds === 'number'
  );
};

/** Valid entries in chronological order; anything unrecognised is dropped. */
export function parseMarkedItems(markedItems: unknown[] | undefined): MarkedItem[] {
  if (!Array.isArray(markedItems)) return [];

  return markedItems
    .filter(isMarkedItem)
    .map(item => ({
      type: item.type,
      text: typeof item.text === 'string' ? item.text : '',
      timestampSeconds: item.timestampSeconds,
    }))
    .sort((left, right) => left.timestampSeconds - right.timestampSeconds);
}
