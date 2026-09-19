// Self-tag: tagging yourself records an activity but must never notify you.
export type MentionSource = 'direct' | 'group' | 'channel' | 'here';

export interface MentionedUser {
  userId: string;
  mentionSource: MentionSource;
}

export type MentionActivityRecipient = MentionedUser;

// Only a direct `@self` by a channel participant counts — `@channel`/`@here`
// expansion includes the sender and must not be treated as a self-tag.
export function isSelfMention(
  mentionedUsers: readonly MentionedUser[],
  senderId: string,
  channelParticipantIds: ReadonlySet<string>
): boolean {
  if (!channelParticipantIds.has(senderId)) return false;
  return mentionedUsers.some(u => u.mentionSource === 'direct' && u.userId === senderId);
}

// validMentionedUsers already excludes the sender (it also feeds notifications
// and app events), so appending here cannot duplicate or notify.
export function buildMentionActivityRecipients(
  validMentionedUsers: readonly MentionActivityRecipient[],
  senderId: string,
  selfMention: boolean
): MentionActivityRecipient[] {
  if (!selfMention || validMentionedUsers.some(u => u.userId === senderId)) {
    return [...validMentionedUsers];
  }
  return [...validMentionedUsers, { userId: senderId, mentionSource: 'direct' }];
}
