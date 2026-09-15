import type { PromiseWithServerResult } from '@rocicorp/zero';

/**
 * Mirror of lotus/src/zero/awaitMutation.ts + dashboard's handleMutationResult.
 * Shared by `sendMessage` and the channel-forward path so both own the same
 * fire-and-forget lifecycle without pulling a platform-specific helper.
 *
 * Zero classifies mutation errors:
 *   - `zero`: transient (protocol / connection / out-of-order). Replicache
 *     retries automatically; treating these as failures would restore the
 *     composer while Zero is still going to persist the write.
 *   - anything else (including `app`): the mutator genuinely rejected; the
 *     optimistic write is rolled back, so restoring the draft is correct.
 */
const isTransientError = (error: unknown): boolean =>
  !!error &&
  typeof error === 'object' &&
  'type' in error &&
  (error as { type: unknown }).type === 'zero';

type SendOutcome = 'ok' | 'app-error';

export function subscribeSendLifecycle(
  mutation: PromiseWithServerResult,
  onAppError: () => void,
  onSettled?: (outcome: SendOutcome) => void,
): void {
  let handled = false;
  const fireAppError = (): void => {
    if (handled) return;
    handled = true;
    onAppError();
    onSettled?.('app-error');
  };

  mutation.client
    .then(result => {
      if (result.type === 'error') {
        if (!isTransientError(result.error)) {
          fireAppError();
        }
        return;
      }
      // Successful client apply — server may still reject; onSettled runs
      // when we know for sure.
      if (!handled) onSettled?.('ok');
    })
    .catch(() => fireAppError());

  mutation.server
    .then(result => {
      if (result.type === 'error' && !isTransientError(result.error)) {
        fireAppError();
      }
    })
    .catch(err => {
      if (!isTransientError(err)) fireAppError();
    });
}
