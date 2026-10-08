import { InteractionReplyValidationError } from '@/integrations/core/baseInteractionReplySender';
import { disconnectDeskSourceBySystem } from '@/integrations/core/deskSourceDisconnect';

export const metaGraphErrorCode = (error: unknown): number | undefined =>
  (error as { response?: { data?: { error?: { code?: number } } } })?.response?.data?.error?.code;

// Meta invalidates a token when the person who connected the account changes their password,
// loses their role, or removes the app (Graph error 190). Page tokens have no expiry date, so
// this is the only sign a Facebook one has died.
export function isMetaTokenRejected(error: unknown): boolean {
  return metaGraphErrorCode(error) === 190;
}

/**
 * For a reply's Graph call: a reply is often the first thing to hit a dead token, so mark the
 * account disconnected (desk settings then offer Reconnect) and tell the agent with `message`.
 */
export const onMetaTokenRejected =
  (sourceId: string, message: string) =>
  async (error: unknown): Promise<never> => {
    if (!isMetaTokenRejected(error)) throw error;
    await disconnectDeskSourceBySystem(sourceId, { clearCredentials: true });
    throw new InteractionReplyValidationError(message);
  };
