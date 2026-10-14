/**
 * §8.1 reuse gate: **Adopt**. Characterised against v2 mentionSchemes. Pure.
 *
 * In-app mention link schemes. Mentions are encoded as markdown links
 * (`[label](scheme + id)`) so they survive the HTML-to-markdown round-trip; the
 * scheme is how renderers tell a mention apart from a real hyperlink.
 */
export const MENTION_USER_SCHEME = 'xyne://user/';
export const MENTION_CHANNEL_SCHEME = 'xyne://channel/';
export const MENTION_GROUP_SCHEME = 'xyne://group/';
export const MENTION_BROADCAST_SCHEME = 'xyne://broadcast/';

export type MentionSchemeKind = 'user' | 'channel' | 'group' | 'broadcast';

export const mentionUrlFor = (kind: MentionSchemeKind, id: string): string => {
  if (kind === 'broadcast') return `${MENTION_BROADCAST_SCHEME}${id}`;
  if (kind === 'channel') return `${MENTION_CHANNEL_SCHEME}${encodeURIComponent(id)}`;
  if (kind === 'group') return `${MENTION_GROUP_SCHEME}${encodeURIComponent(id)}`;
  return `${MENTION_USER_SCHEME}${encodeURIComponent(id)}`;
};
