export type ChatOpenSkeletonSurface = 'channel' | 'thread';
export type ChatOpenSkeletonEntry = 'direct' | 'notification';
export type ChatOpenSkeletonOutcome = 'revealed' | 'abandoned';

export type CompletedChatOpenSkeleton = Readonly<{
  durationMs: number;
  outcome: ChatOpenSkeletonOutcome;
  surface: ChatOpenSkeletonSurface;
  entry: ChatOpenSkeletonEntry;
}>;

export type BeginChatOpenSkeletonInput = Readonly<{
  identityKey: string;
  surface: ChatOpenSkeletonSurface;
  entry: ChatOpenSkeletonEntry;
  nowMs?: number;
}>;

type PendingChatOpenSkeleton = Readonly<{
  identityKey: string;
  surface: ChatOpenSkeletonSurface;
  entry: ChatOpenSkeletonEntry;
  shownAtMs: number;
}>;

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const pendingByKey = new Map<string, PendingChatOpenSkeleton>();
const completionListeners = new Set<(completed: CompletedChatOpenSkeleton) => void>();

function pendingKey(surface: ChatOpenSkeletonSurface, identityKey: string): string {
  return `${surface}-${identityKey}`;
}

function notifyCompleted(completed: CompletedChatOpenSkeleton): void {
  for (const listener of completionListeners) {
    try {
      listener(completed);
    } catch {
      // Completion listeners must never break chat rendering.
    }
  }
}

function finish(
  pending: PendingChatOpenSkeleton,
  outcome: ChatOpenSkeletonOutcome,
  endedAtMs: number,
): CompletedChatOpenSkeleton {
  pendingByKey.delete(pendingKey(pending.surface, pending.identityKey));

  const completed: CompletedChatOpenSkeleton = {
    durationMs: Math.max(0, Math.round(endedAtMs - pending.shownAtMs)),
    outcome,
    surface: pending.surface,
    entry: pending.entry,
  };

  notifyCompleted(completed);
  return completed;
}

export function subscribeChatOpenSkeletonCompleted(
  listener: (completed: CompletedChatOpenSkeleton) => void,
): () => void {
  completionListeners.add(listener);
  return (): void => {
    completionListeners.delete(listener);
  };
}

export function beginChatOpenSkeleton(input: BeginChatOpenSkeletonInput): void {
  const key = pendingKey(input.surface, input.identityKey);
  if (pendingByKey.has(key)) {
    return;
  }

  pendingByKey.set(key, {
    identityKey: input.identityKey,
    surface: input.surface,
    entry: input.entry,
    shownAtMs: input.nowMs ?? nowMs(),
  });
}

export function completeChatOpenSkeleton(input: {
  identityKey: string;
  surface: ChatOpenSkeletonSurface;
  nowMs?: number;
}): CompletedChatOpenSkeleton | null {
  const pending = pendingByKey.get(pendingKey(input.surface, input.identityKey));

  if (pending === undefined) {
    return null;
  }

  return finish(pending, 'revealed', input.nowMs ?? nowMs());
}

export function abandonChatOpenSkeleton(input: {
  identityKey: string;
  surface: ChatOpenSkeletonSurface;
  nowMs?: number;
}): CompletedChatOpenSkeleton | null {
  const pending = pendingByKey.get(pendingKey(input.surface, input.identityKey));

  if (pending === undefined) {
    return null;
  }

  return finish(pending, 'abandoned', input.nowMs ?? nowMs());
}

export function resetChatOpenSkeleton(): void {
  pendingByKey.clear();
  completionListeners.clear();
}
