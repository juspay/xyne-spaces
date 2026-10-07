import type { DisplaySearchResult } from '../../../types/search';
import { formatThreadTimestamp, utcToIst } from '../../../utils/dateUtils';
import type { ListItem } from '../../Assistant/engine/dialogue';

const MAX_TITLE = 60;
const withoutHighlights = (text: string): string => text.replace(/<\/?hi>/gi, '').trim();
// An address in a name is someone's email: it is left out.
const EMAIL = /\S+@\S+\.\S+/g;

/**
 * Xyne Buddy's name for a result: who sent it, or the ticket's, file's or channel's own title;
 * where; and when. Never what a message says, a snippet of it, or anyone's email, since it may be
 * spoken aloud.
 */
export function listItemOf({
  id,
  type,
  title,
  subtitle,
  metadata,
  searchContext,
}: DisplaySearchResult): ListItem {
  const place = searchContext?.channelTitle ?? metadata.channelName;
  const group =
    place && (searchContext?.scopeType ?? 'DEFAULT') === 'DEFAULT' ? `#${place}` : place;
  // When, as this page's cards show it: a message's own time ("Wednesday at 1:30 PM"), else the
  // backend's text, which is in UTC, as the file and mail cards convert it.
  const createdAt = searchContext?.createdAtTimestamp;
  const detail = createdAt ? formatThreadTimestamp(createdAt) : utcToIst(metadata.timestamp);
  // A message's subtitle is "By <sender>" only for a chat message; a mail's is its subject.
  const named =
    type === 'conversation'
      ? (searchContext?.senderName ?? (subtitle.startsWith('By ') ? subtitle.slice(3) : ''))
      : [type === 'ticket' && searchContext?.xyneId, withoutHighlights(title)]
          .filter(Boolean)
          .join(' ');
  const name = named.replace(EMAIL, '').replace(/\s+/g, ' ').trim() || 'Someone';
  const label = name.length > MAX_TITLE ? `${name.slice(0, MAX_TITLE - 1)}…` : name;
  return {
    id,
    label,
    ...(type !== 'channel' && type !== 'user' && group && { group }),
    ...(detail && { detail }),
  };
}
