/**
 * In-app mention link schemes. Mentions are encoded as markdown links
 * (`[label](scheme + id)`) so they survive the HTML-to-markdown round-trip; the
 * scheme is how renderers tell a mention apart from a real hyperlink.
 *
 * Pure module (no React Native imports) so parsers/tests can depend on it.
 */
export const MENTION_USER_SCHEME = 'xyne://user/';
export const MENTION_CHANNEL_SCHEME = 'xyne://channel/';
export const MENTION_GROUP_SCHEME = 'xyne://group/';
export const MENTION_BROADCAST_SCHEME = 'xyne://broadcast/';
