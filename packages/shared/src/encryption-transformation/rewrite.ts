import { extractAllMentions } from '../utils/mentionParser.js';

// The opening tag extractUserMentions / extractGroupMentions match: no closing tag needed,
// either quote at each end. Mentions are found (and notified) from this tag alone. Each
// <span ...> tag is cut out first with a single [^<>]* (one pass, stops at the next tag), then
// read on its own, so guest text can't make the scan quadratic.
const SPAN_TAG = /<span[^<>]*>/g;
const MENTION_TYPE = /data-mention-type=["'](user|group)["']/;
const MENTION_USER_ID = /data-user-id=(["'])([^"']+)\1/;

/**
 * Guests may only mention people in the channel. Any other mention, and any group mention,
 * loses its mention tag and stays as plain text, so participants, notifications and
 * automations never act on it. The backend runs it on plaintext; the encryption service has
 * the content extractor run it on a guest's encrypted message before re-encrypting it, so
 * both store the same text.
 */
export function keepMentionsWithin(htmlContent: string, allowedUserIds: ReadonlySet<string>): string {
  if (!htmlContent.includes('data-mention-type')) return htmlContent;
  const kept = htmlContent.replace(SPAN_TAG, (tag: string) => {
    const type = MENTION_TYPE.exec(tag)?.[1];
    if (!type) return tag;
    const userId = type === 'user' ? MENTION_USER_ID.exec(tag)?.[2] : undefined;
    return userId && allowedUserIds.has(userId) ? tag : '<span>';
  });
  // The extractors decide who is mentioned; if they still find anyone else, drop every mention.
  const { userIds, groupIds } = extractAllMentions(kept);
  return groupIds.length > 0 || userIds.some((id) => !allowedUserIds.has(id))
    ? kept.replace(/data-mention-type/g, 'data-mention-removed')
    : kept;
}
