/**
 * Discriminated pointer to a conversation the user can read/draft/send in.
 *
 * `channel` targets the top-level of a channel — reading returns the list of
 * conversations, sending creates a new one via `mutators.conversations.send`.
 * `thread`  targets a specific conversation inside a channel — reading returns
 * the conversation + its inline messages, sending appends a message via
 * `mutators.messages.send`.
 *
 * The optional `isMember` flag matches the arg that both `channelConversationsPaginatedV3`
 * and `threadConversation` accept for ACL-scoped reads.
 */
export type ChannelRef = {
  kind: 'channel';
  channelId: string;
  isMember?: boolean;
};

export type ThreadRef = {
  kind: 'thread';
  channelId: string;
  conversationId: string;
  isMember?: boolean;
};

export type ConversationRef = ChannelRef | ThreadRef;

/**
 * Stable identity for a ref. Use for memoization, subscription bookkeeping,
 * and cache keys. NOT the same as `lookupId` used by the draft actor — see
 * `draftLookupId`.
 */
export function refKey(ref: ConversationRef): string {
  return ref.kind === 'channel'
    ? `ch:${ref.channelId}`
    : `th:${ref.conversationId}`;
}

/**
 * Key used by `stateMachine`'s SAVE_DRAFT / REMOVE_DRAFT events. Matches the
 * existing draft-store key convention so today's persisted drafts remain
 * addressable after adoption:
 *   - channel: draft lookupId === channelId
 *   - thread:  draft lookupId === conversationId
 */
export function draftLookupId(ref: ConversationRef): string {
  return ref.kind === 'channel' ? ref.channelId : ref.conversationId;
}
