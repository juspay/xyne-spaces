/**
 * Extract user IDs from HTML content containing user mentions
 * Parses spans with data-mention-type="user" and extracts data-user-id
 *
 * Example HTML:
 * <span data-mention-type="user" data-user-id="cmhsw8f3p0021d8sefvk55yzi">@System Administrator</span>
 *
 * @param htmlContent - HTML content containing mentions
 * @returns Array of unique user IDs
 */
export function extractUserMentions(htmlContent: string): string[] {
  // Match span tags that have both data-mention-type=user and data-user-id in any order.
  // Accept either quote style: Slack blocks/attachments emit single-quoted spans (isStringified).
  const userMentionRegex = /<span[^>]*data-mention-type=["']user["'][^>]*>/g;
  const userIdRegex = /data-user-id=(["'])([^"']+)\1/;

  const spans = [...htmlContent.matchAll(userMentionRegex)];
  const userIds = spans
    .map(spanMatch => {
      const userIdMatch = spanMatch[0].match(userIdRegex);
      return userIdMatch ? userIdMatch[2] : null;
    })
    .filter((id): id is string => id !== null);

  // Return unique user IDs
  return [...new Set(userIds)];
}

/**
 * Extract group IDs from HTML content containing group mentions
 * Parses spans with data-mention-type="group" and extracts data-group-id
 *
 * Example HTML:
 * <span data-mention-type="group" data-group-id="cmhsw8f310012d8seyjqnrwwl">@DEVELOPER</span>
 *
 * @param htmlContent - HTML content containing mentions
 * @returns Array of unique group IDs
 */
export function extractGroupMentions(htmlContent: string): string[] {
  // Match span tags that have both data-mention-type=group and data-group-id in any order.
  // Accept either quote style: Slack blocks/attachments emit single-quoted spans (isStringified).
  const groupMentionRegex = /<span[^>]*data-mention-type=["']group["'][^>]*>/g;
  const groupIdRegex = /data-group-id=(["'])([^"']+)\1/;

  const spans = [...htmlContent.matchAll(groupMentionRegex)];
  const groupIds = spans
    .map(spanMatch => {
      const groupIdMatch = spanMatch[0].match(groupIdRegex);
      return groupIdMatch ? groupIdMatch[2] : null;
    })
    .filter((id): id is string => id !== null);

  // Return unique group IDs
  return [...new Set(groupIds)];
}

/**
 * Extract both user and group mentions from HTML content
 *
 * @param htmlContent - HTML content containing mentions
 * @returns Object with arrays of user IDs and group IDs
 */
export function extractAllMentions(htmlContent: string): {
  userIds: string[];
  groupIds: string[];
} {
  return {
    userIds: extractUserMentions(htmlContent),
    groupIds: extractGroupMentions(htmlContent),
  };
}
