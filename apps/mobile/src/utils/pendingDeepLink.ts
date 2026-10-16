/**
 * Hand-off to the root deep-link pipeline.
 *
 * `app/_layout.tsx` owns the only queue that can open a link *across* a workspace
 * switch: it holds the URL in a ref, and a switch remounts the workspace session
 * (new Zero client, new stores) without losing it. Links tapped inside the app are
 * handled by plain functions with no access to that component, so they register here
 * instead of duplicating switch-then-navigate logic per call site.
 *
 * Only cross-workspace links need the queue; same-workspace links still navigate
 * synchronously at the call site, which keeps the common path unchanged.
 */

type DeepLinkQueue = (url: string) => void;

let queue: DeepLinkQueue | null = null;

/** Registers the root queue. Returns an unsubscribe for the owning effect. */
export function registerDeepLinkQueue(next: DeepLinkQueue): () => void {
  queue = next;
  return (): void => {
    if (queue === next) queue = null;
  };
}

/**
 * Hands `url` to the root pipeline. Returns false when no queue is registered (the
 * root layout is not mounted yet), so callers can fall back to their own handling.
 */
export function enqueueDeepLink(url: string): boolean {
  if (!queue) return false;
  queue(url);
  return true;
}
