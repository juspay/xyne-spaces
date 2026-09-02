/**
 * Pure, dependency-free selection logic for the Unread Digest.
 *
 * Kept separate from `unreadDigestService.ts` (which pulls in Prisma and the
 * shared package) so the message-eligibility, capping, and ranking rules can be
 * unit-tested in isolation without booting a database or the ORM.
 */

/** Caps that bound a single digest run. */
export const UNREAD_DIGEST_CAPS = {
  maxChannels: 25,
  maxMessagesPerChannel: 200,
  maxMessagesOverall: 1000,
} as const;

/**
 * Decide whether a raw message belongs in the unread digest for `userId`.
 *
 * A message is in-scope when it:
 *  - is not soft-deleted,
 *  - is not the requesting user's own message,
 *  - is either public (`visibleTo == null`) or addressed to this user,
 *  - was created strictly after the user last viewed the channel, and
 *  - was created at or before the server-owned snapshot boundary (so a message
 *    that arrives mid-generation stays unread and is not silently swallowed).
 */
export function isDigestEligible(
  message: { senderId: string; isDeleted: boolean; visibleTo: string | null; createdAt: Date },
  opts: { userId: string; lastViewedAt: Date | null; snapshotAt: Date }
): boolean {
  if (message.isDeleted) return false;
  if (message.senderId === opts.userId) return false;
  if (message.visibleTo !== null && message.visibleTo !== opts.userId) return false;
  if (message.createdAt.getTime() > opts.snapshotAt.getTime()) return false;
  if (opts.lastViewedAt && message.createdAt.getTime() <= opts.lastViewedAt.getTime()) {
    return false;
  }
  return true;
}

/**
 * Apply the per-channel message cap, keeping the NEWEST messages when trimming
 * but returning them in chronological (ascending) order for the summariser.
 */
export function capChannelMessages<T extends { createdAt: Date }>(
  ascendingMessages: readonly T[],
  cap: number
): { kept: T[]; omitted: number } {
  if (ascendingMessages.length <= cap) {
    return { kept: [...ascendingMessages], omitted: 0 };
  }
  const kept = ascendingMessages.slice(ascendingMessages.length - cap);
  return { kept, omitted: ascendingMessages.length - cap };
}

/**
 * Rank unread channels (highest unread signal first, newest activity as a
 * tiebreak) and apply the channel cap. Deterministic ordering keeps the digest
 * stable across retries.
 */
export function rankAndCapChannels<
  T extends { unreadHint: number; messages: readonly { createdAt: Date }[] }
>(channels: readonly T[], maxChannels: number): { included: T[]; omittedChannelCount: number } {
  const sorted = [...channels].sort((a, b) => {
    if (b.unreadHint !== a.unreadHint) return b.unreadHint - a.unreadHint;
    const aLatest = a.messages.length ? a.messages[a.messages.length - 1].createdAt.getTime() : 0;
    const bLatest = b.messages.length ? b.messages[b.messages.length - 1].createdAt.getTime() : 0;
    return bLatest - aLatest;
  });
  return {
    included: sorted.slice(0, maxChannels),
    omittedChannelCount: Math.max(0, sorted.length - maxChannels),
  };
}
