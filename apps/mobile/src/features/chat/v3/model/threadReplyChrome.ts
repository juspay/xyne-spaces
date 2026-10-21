import type { ChatRow } from './chatRow.types';

export const threadReplyChrome = (
  rows: readonly ChatRow[],
  isThread: boolean,
): { rootId: string | null; count: number } => {
  if (!isThread) {
    return { rootId: null, count: 0 };
  }
  let rootId: string | null = null;
  let loadedCount = 0;
  let parentCount = 0;
  for (const row of rows) {
    if (row.type !== 'message') {
      continue;
    }
    if (rootId === null) {
      rootId = row.id;
      parentCount = row.model.replyPreview?.count ?? 0;
    } else {
      loadedCount += 1;
    }
  }
  return { rootId, count: Math.max(loadedCount, parentCount) };
};

/** Writes the divider onto the parent row so `itemsAreEqual` cannot drop it. */
export const applyThreadReplyChrome = (rows: readonly ChatRow[], isThread: boolean): ChatRow[] => {
  const chrome = threadReplyChrome(rows, isThread);
  return rows.map(row => {
    if (row.type !== 'message') {
      return row;
    }
    const threadReplyCount = row.id === chrome.rootId ? chrome.count : 0;
    if (row.model.threadReplyCount === threadReplyCount) {
      return row;
    }
    return { ...row, model: { ...row.model, threadReplyCount } };
  });
};
