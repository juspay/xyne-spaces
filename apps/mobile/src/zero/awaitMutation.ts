import type { PromiseWithServerResult } from '@rocicorp/zero';

class AppMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppMutationError';
  }
}

/**
 * Zero normalizes every mutation rejection to `{ type: 'app' | 'zero', message }`.
 * - `zero`: transient (protocol / connection / out-of-order). Replicache's
 *   recovery loop re-sends the mutation, so the message will still land — we
 *   MUST NOT surface it, otherwise the composer restores content that Zero is
 *   about to persist.
 * - anything else (including `app`): the mutator genuinely rejected. The
 *   optimistic write is rolled back, so restoring the composer is correct.
 *
 * Matches dashboard's `handleMutationResult` logic in
 * `dashboard/src/components/Chat/ChatInput/ChatInput.tsx`.
 */
const isTransientError = (error: unknown): boolean =>
  !!error &&
  typeof error === 'object' &&
  'type' in error &&
  (error as { type: unknown }).type === 'zero';

const errorMessage = (error: unknown): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(error);
};

/**
 * Await a Zero custom-mutator result and throw on any non-transient rejection.
 *
 * The client half is awaited first so a synchronous mutator throw surfaces
 * immediately (the server half never resolves in that case). If the client
 * apply succeeds, we await the server response — server-side rejections
 * (permission denied, validation, etc.) also throw.
 *
 * Prefer {@linkcode subscribeMutationRestore} in send flows so the composer
 * can commit its clear to paint before the restore runs.
 */
export const awaitMutation = async (mutation: PromiseWithServerResult): Promise<void> => {
  const clientResult = await mutation.client;
  if (clientResult.type === 'error') {
    if (isTransientError(clientResult.error)) return;
    throw new AppMutationError(errorMessage(clientResult.error));
  }

  const serverResult = await mutation.server;
  if (serverResult.type === 'error') {
    if (isTransientError(serverResult.error)) return;
    throw new AppMutationError(errorMessage(serverResult.error));
  }
};

/**
 * Fire-and-forget mutation lifecycle: subscribes `.client` and `.server` for
 * non-transient rejections and calls `restore()` at most once. The caller
 * returns immediately so the composer can visibly clear before the mutation
 * settles. Modeled on dashboard's `handleMutationResult`.
 *
 * `onSettled` runs once the client half has resolved (success or error) —
 * useful for cleanup like removing an optimistic row for a rejected write.
 */
export const subscribeMutationRestore = (
  mutation: PromiseWithServerResult,
  restore: () => void,
  onSettled?: (result: 'ok' | 'app-error') => void,
): void => {
  let restored = false;
  const triggerRestore = (): void => {
    if (restored) return;
    restored = true;
    restore();
  };

  mutation.client
    .then(clientResult => {
      if (clientResult.type === 'error') {
        if (!isTransientError(clientResult.error)) {
          triggerRestore();
          onSettled?.('app-error');
        }
        return;
      }
      onSettled?.('ok');
    })
    .catch(() => {
      triggerRestore();
      onSettled?.('app-error');
    });

  mutation.server
    .then(serverResult => {
      if (serverResult.type === 'error' && !isTransientError(serverResult.error)) {
        triggerRestore();
      }
    })
    .catch(err => {
      if (!isTransientError(err)) triggerRestore();
    });
};
