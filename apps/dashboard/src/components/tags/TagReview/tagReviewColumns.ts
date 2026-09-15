/**
 * Column definitions for the tag review table.
 *
 * Deliberately the same shape as ticketListColumns.ts — a CSS grid of `minmax(0, Nfr)` tracks
 * with a literal selection column — so the two tables line up visually and one recipe governs
 * both. Column keys map onto the ticket list's: Tag sits where Subject does, and so on down
 * the row.
 */
export type TagReviewColumnKey =
  | 'tag'
  | 'threads'
  | 'proposedBy'
  | 'status'
  | 'proposed'
  | 'lastUsed';

export interface TagReviewColumnDefinition {
  key: TagReviewColumnKey;
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
}

export const TAG_REVIEW_SELECTION_COLUMN_WIDTH = 28;
export const TAG_REVIEW_COLUMN_PADDING_X = 24;

export const TAG_REVIEW_COLUMNS: readonly TagReviewColumnDefinition[] = [
  { key: 'tag', label: 'Tag', width: 420, align: 'left' },
  { key: 'threads', label: 'Threads', width: 80, align: 'right' },
  { key: 'proposedBy', label: 'Proposed by', width: 150, align: 'left' },
  { key: 'status', label: 'Status', width: 130, align: 'left' },
  { key: 'proposed', label: 'Proposed', width: 110, align: 'left' },
  { key: 'lastUsed', label: 'Last used', width: 110, align: 'left' },
];

/** One `minmax(0, Nfr)` track per column, so every cell can truncate rather than overflow. */
export const tagReviewGridTemplate = (showSelection: boolean): string =>
  [
    ...(showSelection ? [`${TAG_REVIEW_SELECTION_COLUMN_WIDTH}px`] : []),
    ...TAG_REVIEW_COLUMNS.map(column => `minmax(0, ${column.width}fr)`),
  ].join(' ');

export const tagReviewAlignClass = (key: TagReviewColumnKey): string => {
  const column = TAG_REVIEW_COLUMNS.find(entry => entry.key === key);
  if (column?.align === 'right') return 'justify-end text-right';
  if (column?.align === 'center') return 'justify-center text-center';
  return 'justify-start text-left';
};
