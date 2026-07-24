export interface TicketEmailFilterLike {
  from?: unknown;
  to?: unknown;
}

const emailAddressPattern = /<([^>]+)>/;

export const normalizeEmailAddress = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const match = trimmed.match(emailAddressPattern);
  return (match?.[1] ?? trimmed).trim().toLowerCase();
};

export const hasEmailAddressFilters = (
  fromEmails?: readonly string[],
  toEmails?: readonly string[],
): boolean => Boolean(fromEmails?.some(Boolean) || toEmails?.some(Boolean));

const matchesAnyAddress = (value: unknown, filters: readonly string[]): boolean => {
  const normalizedValue = normalizeEmailAddress(value);
  return normalizedValue.length > 0 && filters.includes(normalizedValue);
};

export const ticketMatchesEmailFilters = (
  ticket: unknown,
  fromEmails: readonly string[] = [],
  toEmails: readonly string[] = [],
): boolean => {
  const normalizedFromEmails = fromEmails.map(normalizeEmailAddress).filter(Boolean);
  const normalizedToEmails = toEmails.map(normalizeEmailAddress).filter(Boolean);

  if (!hasEmailAddressFilters(normalizedFromEmails, normalizedToEmails)) return true;

  const rawEmails =
    ticket && typeof ticket === 'object' ? (ticket as { emails?: unknown }).emails : undefined;
  const emails = Array.isArray(rawEmails) ? rawEmails : [];
  return emails.some(rawEmail => {
    if (!rawEmail || typeof rawEmail !== 'object') return false;
    const email = rawEmail as TicketEmailFilterLike;
    const recipients = Array.isArray(email.to) ? email.to : [];
    const fromMatches =
      normalizedFromEmails.length === 0 || matchesAnyAddress(email.from, normalizedFromEmails);
    const toMatches =
      normalizedToEmails.length === 0 ||
      recipients.some(recipient => matchesAnyAddress(recipient, normalizedToEmails));
    return fromMatches && toMatches;
  });
};
