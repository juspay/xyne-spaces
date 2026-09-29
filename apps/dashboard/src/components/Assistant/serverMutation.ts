import type { MutatorResult } from '@rocicorp/zero';

/** Waits for Zero's authoritative result and keeps any completed work in the error message. */
export async function requireServerMutation(
  mutation: Pick<MutatorResult, 'server'>,
  failureContext: string,
): Promise<void> {
  const result = await mutation.server;
  if (result.type === 'error') {
    const detail = result.error.message;
    throw new Error(detail ? `${failureContext} ${detail}` : failureContext);
  }
}
