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
 * Parse a comma- or semicolon-separated list of email addresses (which may
 * include display names such as "Name <user@domain>") and return the bare
 * addresses that are not already present in `existingEmails`.
 *
 * Used to merge a channel's configured default CC / "trail mail" list into
 * outbound replies without creating duplicates.
 */
export const parseDefaultCcEmails = (
  raw: string | null | undefined,
  existingEmails: readonly string[] | null | undefined,
): string[] => {
  if (!raw?.trim()) return [];

  const existingSet = new Set(
    (existingEmails ?? [])
      .map(extractEmailAddress)
      .filter((email): email is string => email !== null),
  );

  return [...new Set(
    raw
      .split(/[,;]+/)
      .map(part => extractEmailAddress(part))
      .filter((email): email is string => email !== null && !existingSet.has(email)),
  )];
};
