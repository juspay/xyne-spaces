/**
 * Mention parsing for the backend.
 *
 * User and group mention extraction lives in @xyne/shared so the code-block
 * exclusion cannot drift between the two implementations — this module used to
 * carry a byte-identical copy, which is how a mention inside a <pre>/<code>
 * region kept firing automations, bot replies and radar matches after the
 * shared copy was fixed. Only the channel-reference helper below is
 * backend-local; @xyne/shared has no equivalent.
 */
import { extractAllMentions } from '@xyne/shared/utils';

export {
  extractUserMentions,
  extractGroupMentions,
  extractAllMentions,
} from '@xyne/shared/utils';

/**
 * Extract channel IDs from #channel reference spans (data-channel-mention -> data-channel-id).
 * Excludes the id-less "@channel" broadcast keyword (data-mention-type="channel").
 */
export function extractChannelMentions(htmlContent: string): string[] {
  // Match span tags carrying the data-channel-mention marker (the #channel reference)
  const channelMentionRegex = /<span[^>]*data-channel-mention[^>]*>/g;
  // Accept either quote style: Slack blocks/attachments emit single-quoted spans (isStringified).
  const channelIdRegex = /data-channel-id=(["'])([^"']+)\1/;

  const spans = [...htmlContent.matchAll(channelMentionRegex)];
  const channelIds = spans
    .map(spanMatch => {
      const channelIdMatch = spanMatch[0].match(channelIdRegex);
      return channelIdMatch ? channelIdMatch[2] : null;
    })
    .filter((id): id is string => id !== null);

  // Return unique channel IDs
  return [...new Set(channelIds)];
}


// The opening tag @xyne/shared's extractUserMentions / extractGroupMentions match: no closing tag
// needed, either quote at each end. Mentions are found (and notified) from this tag alone.
const MENTION_TAG = /<span[^>]*data-mention-type=["'](user|group)["'][^>]*>/g;
const MENTION_USER_ID = /data-user-id=(["'])([^"']+)\1/;

/**
 * Guests may only mention people in the channel. Any other mention, and any group mention,
 * loses its mention tag and stays as plain text, so participants, notifications and
 * automations never act on it.
 */
export function keepMentionsWithin(htmlContent: string, allowedUserIds: ReadonlySet<string>): string {
  if (!htmlContent.includes('data-mention-type')) return htmlContent;
  const kept = htmlContent.replace(MENTION_TAG, (tag: string, type: string) => {
    const userId = type === 'user' ? MENTION_USER_ID.exec(tag)?.[2] : undefined;
    return userId && allowedUserIds.has(userId) ? tag : '<span>';
  });
  // The extractors decide who is mentioned; if they still find anyone else, drop every mention.
  const { userIds, groupIds } = extractAllMentions(kept);
  return groupIds.length > 0 || userIds.some((id) => !allowedUserIds.has(id))
    ? kept.replace(/data-mention-type/g, 'data-mention-removed')
    : kept;
}
