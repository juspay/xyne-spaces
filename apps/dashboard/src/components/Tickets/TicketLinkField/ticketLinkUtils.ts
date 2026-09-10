export const EXTERNAL_URL_PATTERN = /^https?:\/\/\S+$/i;

const XYNE_ID_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/i;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Values stored by the TICKET field are xyneIds ("TOKEN-4127"); legacy uuids stay valid. */
export const looksLikeXyneId = (value: string): boolean => XYNE_ID_PATTERN.test(value);

export const looksLikeTicketId = (value: string): boolean => UUID_PATTERN.test(value);

export type PastedTicketRef = { kind: 'id' | 'xyneId'; value: string };

export const isExternalHttpUrl = (value: string): boolean => EXTERNAL_URL_PATTERN.test(value);

/**
 * Pull a ticket reference out of a pasted URL: an xyneId segment anywhere in the
 * path, then the last path segment if it's a ticket uuid, then a `ticketId` query param.
 */
export const extractTicketRefFromUrl = (rawUrl: string): PastedTicketRef | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const xyneIdSegment = segments.find(segment => XYNE_ID_PATTERN.test(segment));
  if (xyneIdSegment) {
    return { kind: 'xyneId', value: xyneIdSegment.toUpperCase() };
  }

  const ticketIdParam = url.searchParams.get('ticketId');
  if (ticketIdParam) {
    return { kind: 'id', value: ticketIdParam };
  }

  const lastSegment = segments[segments.length - 1];
  if (lastSegment) {
    const decoded = decodeURIComponent(lastSegment);
    if (UUID_PATTERN.test(decoded)) {
      return { kind: 'id', value: decoded };
    }
  }

  return null;
};

export const formatShortDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export const toDateInputValue = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);

export type HighlightPart = { text: string; match: boolean };

/** Split a title into parts, flagging case-insensitive substring matches of the query. */
export const splitTitleByQuery = (title: string, query: string): HighlightPart[] => {
  const trimmed = query.trim();
  if (!trimmed) return [{ text: title, match: false }];

  const parts: HighlightPart[] = [];
  const lowerTitle = title.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  let cursor = 0;

  for (;;) {
    const index = lowerTitle.indexOf(lowerQuery, cursor);
    if (index === -1) {
      if (cursor < title.length) parts.push({ text: title.slice(cursor), match: false });
      return parts;
    }
    if (index > cursor) parts.push({ text: title.slice(cursor, index), match: false });
    parts.push({ text: title.slice(index, index + trimmed.length), match: true });
    cursor = index + trimmed.length;
  }
};
