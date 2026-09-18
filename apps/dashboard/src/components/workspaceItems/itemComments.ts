import type { WorkspaceItem, WorkspaceItemSource } from './itemDescriptor';

/**
 * Where a comment sits inside an item. The quote is what survives an edit; the
 * selector and position are hints that speed the search up and are allowed to
 * go stale.
 */
export interface CommentAnchor {
  quote: string;
  selector?: string;
  /** Line number for a diff or a text file, 1-based on the new side. */
  line?: number;
  /** Character offset into the item's text, when there is a stable text form. */
  offset?: number;
}

export interface ItemComment {
  id: string;
  itemId: string;
  body: string;
  author: { id: string; name: string };
  createdAt: string;
  anchor?: CommentAnchor;
  resolved?: boolean;
  /** Written by a run rather than a person. */
  byAgent?: boolean;
}

export interface NewItemComment {
  body: string;
  anchor?: CommentAnchor;
}

export interface CommentStore {
  list: (item: WorkspaceItem) => Promise<ItemComment[]>;
  add?: (item: WorkspaceItem, comment: NewItemComment) => Promise<ItemComment>;
  resolve?: (item: WorkspaceItem, commentId: string, resolved: boolean) => Promise<void>;
}

const stores = new Map<WorkspaceItemSource, CommentStore>();

export function registerCommentStore(source: WorkspaceItemSource, store: CommentStore): void {
  stores.set(source, store);
}

export function commentStoreFor(item: WorkspaceItem): CommentStore | null {
  return stores.get(item.source) ?? null;
}

export type AnchorMatch =
  | { kind: 'exact'; offset: number }
  | { kind: 'moved'; offset: number }
  | { kind: 'lost' };

const MIN_QUOTE_CHARS = 8;

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Finds a comment's quote in the item's current text. An exact hit at the
 * remembered offset means nothing moved; a hit elsewhere means the content
 * shifted; no hit at all means the passage is gone and the comment must be
 * shown unanchored rather than pinned somewhere wrong.
 */
export function findAnchor(text: string, anchor: CommentAnchor | undefined): AnchorMatch {
  if (!anchor || !anchor.quote) return { kind: 'lost' };

  const haystack = normalise(text);
  const needle = normalise(anchor.quote);
  if (needle.length < MIN_QUOTE_CHARS) return { kind: 'lost' };

  const exactAt = anchor.offset ?? -1;
  if (exactAt >= 0 && haystack.startsWith(needle, exactAt)) {
    return { kind: 'exact', offset: exactAt };
  }

  const found = haystack.indexOf(needle);
  if (found >= 0) return { kind: 'moved', offset: found };

  const half = needle.slice(0, Math.max(MIN_QUOTE_CHARS, Math.floor(needle.length / 2)));
  const partial = haystack.indexOf(half);
  return partial >= 0 ? { kind: 'moved', offset: partial } : { kind: 'lost' };
}

export function sortComments(comments: readonly ItemComment[]): ItemComment[] {
  return [...comments].sort((a, b) => {
    if (!!a.resolved !== !!b.resolved) return a.resolved ? 1 : -1;
    const left = a.anchor?.line ?? a.anchor?.offset ?? Number.MAX_SAFE_INTEGER;
    const right = b.anchor?.line ?? b.anchor?.offset ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

const commentListeners = new Set<(itemId: string) => void>();

export function notifyCommentsChanged(itemId: string): void {
  for (const listener of [...commentListeners]) listener(itemId);
}

export function onCommentsChanged(listener: (itemId: string) => void): () => void {
  commentListeners.add(listener);
  return () => commentListeners.delete(listener);
}
