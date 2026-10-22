/** What the summariser writes as Details when the thread holds nothing that tells the case apart. */
export const NO_DISTINGUISHING_DETAIL = 'No distinguishing detail yet';

/** What the summariser writes as CauseKey when the cause is not known. */
export const UNKNOWN_CAUSE_KEY = 'unknown';

interface TicketThreadSummaryParts {
  problem: string;
  details: string;
  cause: string;
  resolution: string;
  causeKey: string;
}

const LABEL_LINE = /^(Problem|Details|Cause|Resolution|CauseKey)\s*:\s*/i;
const PART_BY_LABEL: Record<string, keyof TicketThreadSummaryParts> = {
  problem: 'problem',
  details: 'details',
  cause: 'cause',
  resolution: 'resolution',
  causekey: 'causeKey',
};

/** The labelled parts of a summary; a part the text lacks is ''. */
const parseTicketThreadSummary = (summary: string): TicketThreadSummaryParts => {
  const parts: TicketThreadSummaryParts = { problem: '', details: '', cause: '', resolution: '', causeKey: '' };
  let current: keyof TicketThreadSummaryParts | null = null;
  for (const line of summary.split('\n')) {
    const match = line.match(LABEL_LINE);
    if (match) {
      current = PART_BY_LABEL[match[1]!.toLowerCase()]!;
      parts[current] = line.slice(match[0].length).trim();
    } else if (current && line.trim()) {
      parts[current] = `${parts[current]} ${line.trim()}`.trim();
    }
  }
  return parts;
};

const UNKNOWN_CAUSE = /^(unknown|unclear|not (?:known|stated|clear|specified))\b/i;
const NO_RESOLUTION = /^(not resolved yet|support (acknowledged|escalated|forwarded|logged|will|promised)|escalated|auto-acknowledg)\b/i;
// A pending step anywhere in the line ("Ticket reopened; executive will contact"). "Awaiting"
// only counts at the start: after a stated outcome it is a loose end, not the whole answer.
const PENDING_RESOLUTION =
  /\b(re-?opened|will (contact|call|check|revert|get back|update|investigate|look into|share|follow up)|(under|pending) (review|investigation)|being (checked|investigated|reviewed))\b|^(\w+ )?(support )?(is )?(awaiting|investigating)\b/i;
const SNAKE_TOKEN = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

const normaliseKey = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/**
 * The summary's cause key, normalised, or null when the cause is unknown. A key next to
 * "Cause: Unknown" is the summariser naming the symptom, not a cause, so it is dropped.
 * When the CauseKey line is missing but Cause itself is a snake_case token (the
 * summariser sometimes writes the key there), that token is the key.
 */
export const causeKeyOf = (summary: string): string | null => {
  const parts = parseTicketThreadSummary(summary);
  if (!parts.cause || UNKNOWN_CAUSE.test(parts.cause)) return null;
  const key = normaliseKey(parts.causeKey);
  if (key) return key === UNKNOWN_CAUSE_KEY ? null : key;
  const cause = parts.cause.trim();
  return SNAKE_TOKEN.test(cause) ? cause : null;
};

/** True when the summary states how the ticket was resolved. */
export const hasResolution = (summary: string): boolean => {
  const { resolution } = parseTicketThreadSummary(summary);
  return resolution !== '' && !NO_RESOLUTION.test(resolution) && !PENDING_RESOLUTION.test(resolution);
};

/**
 * The text a ticket is matched on: its problem, details and cause key. Cause and
 * resolution stay out — on an open ticket they are placeholders every other open ticket
 * shares, which would pull unresolved tickets ahead of solved ones. The cause key, when
 * known, is a rare token that lands on tickets summarised with the same key.
 */
export const summaryMatchText = (summary: string): string => {
  const { problem, details } = parseTicketThreadSummary(summary);
  const causeKey = causeKeyOf(summary);
  return [problem, details, causeKey].filter(Boolean).join('\n') || summary;
};

// An id, amount, error code or quoted error message: the summariser sometimes puts these in
// Problem and still writes the placeholder in Details.
const IDENTIFIER = /\d{3,}|"[^"]{4,}"|\b[A-Z]{1,5}[-_]?\d{2,}\b|\b[A-Z0-9]+(?:_[A-Z0-9]+)+\b|\b(?:rs|inr|₹)\s?\d/i;

/**
 * False when the thread has nothing yet that tells this case apart: the summariser wrote
 * the placeholder in Details, Problem carries no identifier and no cause is stated.
 */
export const hasDistinguishingDetail = (summary: string): boolean => {
  const { problem, details } = parseTicketThreadSummary(summary);
  if (!problem && !details) return true;
  if (details !== '' && !details.toLowerCase().startsWith(NO_DISTINGUISHING_DETAIL.toLowerCase())) return true;
  return IDENTIFIER.test(problem) || causeKeyOf(summary) !== null;
};
