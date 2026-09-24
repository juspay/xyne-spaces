import type { CommentAnchor } from './itemComments';

export type AnchorRevealer = (anchor: CommentAnchor) => void;

const revealers = new Map<string, AnchorRevealer>();

export function registerAnchorRevealer(itemId: string, revealer: AnchorRevealer): () => void {
  revealers.set(itemId, revealer);
  return () => {
    if (revealers.get(itemId) === revealer) revealers.delete(itemId);
  };
}

export function revealAnchor(itemId: string, anchor: CommentAnchor | undefined): boolean {
  if (!anchor) return false;
  const revealer = revealers.get(itemId);
  if (typeof revealer !== 'function') return false;
  revealer(anchor);
  return true;
}

type CommentRequest = { itemId: string; commentId?: string };

const commentRequests = new Set<(request: CommentRequest) => void>();

export function requestComments(itemId: string, commentId?: string): void {
  const request: CommentRequest = commentId ? { itemId, commentId } : { itemId };
  for (const listener of [...commentRequests]) listener(request);
}

export function onCommentsRequested(listener: (request: CommentRequest) => void): () => void {
  commentRequests.add(listener);
  return () => commentRequests.delete(listener);
}
