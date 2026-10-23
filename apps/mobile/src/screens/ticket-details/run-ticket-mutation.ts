import type { PromiseWithServerResult } from '@rocicorp/zero';

import { awaitMutation } from '@/src/zero/awaitMutation';
import { showMessageToast } from '@/src/utils/toast';

/**
 * Shared ticket-details mutation lifecycle: await Zero result and toast ACL /
 * validation failures. Returns whether the mutation succeeded.
 */
export async function runTicketMutation(
  mutation: PromiseWithServerResult,
  fallbackError: string,
): Promise<boolean> {
  try {
    await awaitMutation(mutation);
    return true;
  } catch (error) {
    const message = error instanceof Error && error.message.trim() ? error.message : fallbackError;
    showMessageToast(message, 'error');
    return false;
  }
}
