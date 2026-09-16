import { ChannelScopeType } from '@xyne/shared';

/**
 * The unit Radar parses, bookmarks and debounces.
 *
 * In a named channel that unit is the thread: a conversation is a real
 * container, so its id serves as window scope, watermark key and queue job id
 * at once.
 *
 * A DM has no such container. Every top-level message starts its own
 * conversation, so a thread-keyed Radar sees a window of one message, an empty
 * context tail, and open items it can never match — the ask and its answer land
 * in sibling conversations. A DM is therefore keyed by its CHANNEL, which is
 * the conversation as the two people experience it.
 *
 * GROUP_DM keeps thread keying on purpose: "the counterpart" is only
 * well-defined for two people, and the ownerless-assignment path already draws
 * the same line.
 */
export interface RadarScope {
  /** Watermark primary key and Bull job id. */
  key: string;
  channelId: string;
  /** The conversation whose message triggered this job. */
  conversationId: string;
  /** Channel-keyed: the window spans the channel's conversations. */
  isDmChannel: boolean;
}

/** Marks a scope as channel-keyed. Conversation ids are cuids, so this cannot
 *  collide with one. */
export const DM_SCOPE_PREFIX = 'dm:';

/** The channel a channel-keyed scope points at, or null for a thread scope. */
export const dmChannelIdFromScopeKey = (scopeKey: string): string | null =>
  scopeKey.startsWith(DM_SCOPE_PREFIX) ? scopeKey.slice(DM_SCOPE_PREFIX.length) : null;

export const scopeKeyFor = (
  scopeType: string | null | undefined,
  channelId: string,
  conversationId: string
): string =>
  scopeType === ChannelScopeType.DM ? `${DM_SCOPE_PREFIX}${channelId}` : conversationId;

export const radarScopeFor = (
  scopeType: string | null | undefined,
  channelId: string,
  conversationId: string
): RadarScope => ({
  key: scopeKeyFor(scopeType, channelId, conversationId),
  channelId,
  conversationId,
  isDmChannel: scopeType === ChannelScopeType.DM,
});
