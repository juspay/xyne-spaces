import type { ChatPaintRow } from './chatPaint.types';

/** Collect every custom emoji dependency that can paint in a row at any fidelity. */
export const collectPaintEmojiIds = (rows: readonly ChatPaintRow[]): string[] => {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.body.customEmojiIds.length > 0) {
      for (const emojiId of row.body.customEmojiIds) ids.add(emojiId);
    } else {
      for (const segment of row.previewSegments ?? []) {
        if (segment.kind === 'emoji' && segment.emojiId && !segment.uri) ids.add(segment.emojiId);
      }
    }
    for (const emojiId of row.parentPreview?.customEmojiIds ?? []) ids.add(emojiId);
  }
  return [...ids];
};
