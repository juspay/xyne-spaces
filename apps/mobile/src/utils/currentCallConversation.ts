/** Joined calls get their thread identity from the synced call, not the initiate payload. */
export function currentCallConversation(context: {
  externalId: string | null;
  conversationId: string | null;
  activeCalls: readonly {
    externalId: string;
    callOrigin?: string | null;
    metadata?: unknown;
  }[];
}): string | null {
  const call = context.activeCalls.find(value => value.externalId === context.externalId);
  if (!call) return context.conversationId;
  if (call.callOrigin !== 'CONVERSATION') return null;
  let metadata = call.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = null;
    }
  }
  const threadId =
    metadata && typeof metadata === 'object' && 'conversationId' in metadata
      ? metadata.conversationId
      : null;
  // An unresolved thread must never be mistaken for a channel-wide call.
  return typeof threadId === 'string' && threadId
    ? threadId
    : context.conversationId || call.externalId;
}
