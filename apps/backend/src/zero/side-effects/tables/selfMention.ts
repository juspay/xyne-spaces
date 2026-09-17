/**
 * Self-tag (self-mention) helpers for the message side-effect path.
 *
 * Tagging yourself must record an activity (so the message is findable under
 * "Your mentions") WITHOUT ever notifying you about your own message. The split
 * lives here as pure functions so the invariant is unit-testable instead of
 * being buried in the side-effect handler.
 */

export type MentionSource = 'direct' | 'group' | 'channel' | 'here';

export interface MentionedUser {
  userId: string;
  mentionSource: MentionSource;
}

export interface MentionActivityRecipient {
  userId: string;
  mentionSource: MentionSource;
}

/**
 * True when the sender directly (`@name`, not `@channel`/`@here`) tagged
 * themselves in a channel they participate in.
 *
 * Group/broadcast mentions never count: expanding `@channel` includes the
 * sender, and treating that as a self-tag would create an activity for every
 * broadcast the sender writes.
 */
export function isSelfMention(
  mentionedUsers: readonly MentionedUser[],
  senderId: string,
  channelParticipantIds: ReadonlySet<string>
): boolean {
  if (!channelParticipantIds.has(senderId)) return false;
  return mentionedUsers.some(u => u.mentionSource === 'direct' && u.userId === senderId);
}

/**
 * Activity recipients for a message's mentions.
 *
 * `validMentionedUsers` has already excluded the sender (it is also what feeds
 * notifications and app events), so appending the sender here can never
 * duplicate an activity, and the sender is never added to any notification set.
 */
export function buildMentionActivityRecipients(
  validMentionedUsers: readonly MentionActivityRecipient[],
  senderId: string,
  selfMention: boolean
): MentionActivityRecipient[] {
  if (!selfMention) return [...validMentionedUsers];
  if (validMentionedUsers.some(u => u.userId === senderId)) return [...validMentionedUsers];
  return [...validMentionedUsers, { userId: senderId, mentionSource: 'direct' }];
}
