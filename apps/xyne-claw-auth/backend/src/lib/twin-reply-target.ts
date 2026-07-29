/**
 * Pure destination-routing for a Digital Twin reply — no config/IO imports, so
 * it is unit-testable in isolation. Used by the shared delivery in
 * `twin-delivery.ts` (which re-exports it).
 */

/** Resolve a Twin reply destination descriptor to a Spaces post target.
 *  `origin_channel` / `channel` post a NEW top-level message (no conversationId);
 *  `origin_thread` / `thread` post into an existing thread. Unknown kinds fall
 *  back to the origin thread — post-as-user is the hard permission gate regardless. */
export function resolveTwinReplyTarget(
  kind: string,
  ids: { targetChannelId: string; targetConversationId: string; destinationChannelId?: string | undefined; destinationConversationId?: string | undefined },
): { channelId: string; conversationId?: string } {
  switch (kind) {
    case "origin_channel":
      return { channelId: ids.targetChannelId };
    case "channel":
      return { channelId: ids.destinationChannelId ?? ids.targetChannelId };
    case "thread":
      return ids.destinationChannelId && ids.destinationConversationId
        ? { channelId: ids.destinationChannelId, conversationId: ids.destinationConversationId }
        : { channelId: ids.targetChannelId, conversationId: ids.targetConversationId };
    case "origin_thread":
    default:
      return { channelId: ids.targetChannelId, conversationId: ids.targetConversationId };
  }
}
