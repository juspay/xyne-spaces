import {
  isSelfMention,
  buildMentionActivityRecipients,
  type MentionedUser,
  type MentionActivityRecipient,
} from './selfMention';

const SENDER = 'user-sender';
const OTHER = 'user-other';
const PARTICIPANTS = new Set([SENDER, OTHER]);

/**
 * Mirrors the handler: `validMentionedUsers` keeps only direct/group mentions of
 * channel participants, and always drops the sender. Notifications are derived
 * from the same sender-excluded set.
 */
function buildValidMentionedUsers(
  mentionedUsers: readonly MentionedUser[],
  senderId: string,
  participants: ReadonlySet<string>
): MentionActivityRecipient[] {
  return mentionedUsers
    .filter(u => u.mentionSource === 'direct' || u.mentionSource === 'group')
    .filter(u => participants.has(u.userId) && u.userId !== senderId)
    .map(u => ({ userId: u.userId, mentionSource: u.mentionSource }));
}

describe('self-tag mention split', () => {
  it('self-tag in a channel produces exactly one activity for the sender and no notification', () => {
    const mentions: MentionedUser[] = [{ userId: SENDER, mentionSource: 'direct' }];
    const valid = buildValidMentionedUsers(mentions, SENDER, PARTICIPANTS);
    const selfMention = isSelfMention(mentions, SENDER, PARTICIPANTS);

    expect(selfMention).toBe(true);
    // notification/app-event set is `valid` — the sender must not be in it
    expect(valid).toHaveLength(0);

    const recipients = buildMentionActivityRecipients(valid, SENDER, selfMention);
    expect(recipients).toEqual([{ userId: SENDER, mentionSource: 'direct' }]);
    expect(recipients.filter(r => r.userId === SENDER)).toHaveLength(1);
  });

  it('self + other mention gives activities for both but a notification only for the other user', () => {
    const mentions: MentionedUser[] = [
      { userId: SENDER, mentionSource: 'direct' },
      { userId: OTHER, mentionSource: 'direct' },
    ];
    const valid = buildValidMentionedUsers(mentions, SENDER, PARTICIPANTS);
    const selfMention = isSelfMention(mentions, SENDER, PARTICIPANTS);

    expect(valid).toEqual([{ userId: OTHER, mentionSource: 'direct' }]);

    const recipients = buildMentionActivityRecipients(valid, SENDER, selfMention);
    expect(recipients.map(r => r.userId).sort()).toEqual([OTHER, SENDER].sort());
    expect(recipients.filter(r => r.userId === SENDER)).toHaveLength(1);
  });

  it('a group mention (@channel/@here) alone is not a self-tag', () => {
    const mentions: MentionedUser[] = [
      { userId: SENDER, mentionSource: 'group' },
      { userId: OTHER, mentionSource: 'group' },
    ];
    const selfMention = isSelfMention(mentions, SENDER, PARTICIPANTS);
    expect(selfMention).toBe(false);

    const valid = buildValidMentionedUsers(mentions, SENDER, PARTICIPANTS);
    const recipients = buildMentionActivityRecipients(valid, SENDER, selfMention);
    expect(recipients.some(r => r.userId === SENDER)).toBe(false);
  });

  it('other-user mention only leaves the existing flow unchanged', () => {
    const mentions: MentionedUser[] = [{ userId: OTHER, mentionSource: 'direct' }];
    const valid = buildValidMentionedUsers(mentions, SENDER, PARTICIPANTS);
    const selfMention = isSelfMention(mentions, SENDER, PARTICIPANTS);

    expect(selfMention).toBe(false);
    expect(buildMentionActivityRecipients(valid, SENDER, selfMention)).toEqual(valid);
  });

  it('a self-tag in a channel the sender does not participate in is ignored', () => {
    const mentions: MentionedUser[] = [{ userId: SENDER, mentionSource: 'direct' }];
    expect(isSelfMention(mentions, SENDER, new Set([OTHER]))).toBe(false);
  });

  it('never appends a duplicate activity if the sender is somehow already present', () => {
    const valid: MentionActivityRecipient[] = [{ userId: SENDER, mentionSource: 'direct' }];
    const recipients = buildMentionActivityRecipients(valid, SENDER, true);
    expect(recipients).toHaveLength(1);
  });
});
