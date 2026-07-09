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
