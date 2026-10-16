/**
 * Extract a bare lowercased email address from any of the common formats
 * we see across the system:
 *   - `user@domain`                          (Google ExternalSource.displayName, raw senders)
 *   - `Name <user@domain>`                   (RFC 5322 headers, Zoho thread fromEmailAddress)
 *   - `Wrapper text (user@domain)`           (legacy Microsoft displayName)
 *
 * Returns `null` if no email is found.
 */
export const extractEmailAddress = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const match = raw.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return match ? match[0].toLowerCase() : null;
};

export const normalizeEmailList = (
  emails: readonly string[] | null | undefined,
): string[] => {
  if (!emails?.length) return [];

  return [...new Set(
    emails
      .map(email => email.trim().toLowerCase())
      .filter(Boolean),
  )];
};

export const findNewEmails = (
  nextEmails: readonly string[] | null | undefined,
  existingEmails: readonly string[] | null | undefined,
): string[] => {
  const existingEmailSet = new Set(normalizeEmailList(existingEmails));
  return normalizeEmailList(nextEmails).filter(email => !existingEmailSet.has(email));
};

/**
 * Who a reply goes to when the caller names nobody.
 *
 * On a thread a customer opened that is the initial email's sender (plus its
 * other recipients for a reply-all), as it always was. On a thread the desk
 * itself opened — Compose, or the first email on a ticket raised without one —
 * the initial sender is OUR mailbox, so "reply to the sender" would mail the
 * desk; the other party is in `to` there.
 */
export const resolveDefaultReplyRecipients = (params: {
  type: 'REPLY' | 'REPLY_ALL';
  initialEmail: { from: string; to: readonly string[]; replyTo?: readonly string[] | null };
  ownAddresses: ReadonlyArray<string | null | undefined>;
}): string[] => {
  const { type, initialEmail } = params;
  const own = new Set(
    params.ownAddresses.map(address => extractEmailAddress(address)).filter((a): a is string => !!a),
  );
  const isOwn = (address: string): boolean => {
    const bare = extractEmailAddress(address);
    return !!bare && own.has(bare);
  };
  const initialSender = initialEmail.replyTo?.[0] ?? initialEmail.from;
  const otherParties = isOwn(initialEmail.from)
    ? [...new Set([...(initialEmail.replyTo ?? []), ...initialEmail.to].filter(address => !isOwn(address)))]
    : [];
  if (otherParties.length > 0) return type === 'REPLY' ? [otherParties[0]] : otherParties;
  return type === 'REPLY' ? [initialSender] : [...new Set([initialSender, ...initialEmail.to])];
};
