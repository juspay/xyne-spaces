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

