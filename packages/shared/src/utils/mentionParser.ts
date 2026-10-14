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
/**
 * Remove <pre>…</pre> and <code>…</code> regions from HTML before mention
 * extraction. A mention span that lives inside a code block/inline code is a
 * false positive (e.g. `@name` inside an email in a SQL snippet) and must NOT
 * produce a notification. Kept as a string transform (no DOM) so it works in
 * both the browser and Node/worker contexts that share this module.
 *
 * The attribute class excludes '<' as well as '>': message bodies are attacker
 * controlled, and `[^>]*` lets a run of unterminated '<pre' re-scan the tail
 * from every position (js/polynomial-redos). A real tag's attributes cannot
 * contain a raw '<', so nothing valid is lost.
 */
export function stripCodeRegions(htmlContent: string): string {
  return (
    htmlContent
      // Balanced regions: strip just the <pre>…</pre> / <code>…</code> span.
      .replace(/<pre\b[^<>]*>[\s\S]*?<\/pre>/gi, ' ')
      .replace(/<code\b[^<>]*>[\s\S]*?<\/code>/gi, ' ')
      // Unclosed / mismatched openers: a <pre/<code with no matching close is
      // left untouched by the balanced pass above, so its mention spans would
      // still be extracted and notify — while the DOM renderer auto-closes the
      // tag at end-of-input and flattens them (a notify-without-chip
      // divergence). Mirror the DOM: strip from the dangling opener to
      // end-of-string. Runs after the balanced pass so well-formed trailing
      // regions are already removed, and never backtracks (js/polynomial-redos).
      .replace(/<pre\b[^<>]*>[\s\S]*$/i, ' ')
      .replace(/<code\b[^<>]*>[\s\S]*$/i, ' ')
  );
}

// One <span ...> tag per match, stopping at the next tag, then each tag read on its own. A single
// regex spanning the attributes ([^>]* on both sides) re-scans the rest of the message from every
// unclosed '<span' (js/polynomial-redos); a real tag's attributes never hold a raw '<'.
const SPAN_TAG = /<span\b[^<>]*>/g;

function mentionIds(htmlContent: string, type: 'user' | 'group', idAttr: RegExp): string[] {
  const typeAttr = type === 'user' ? /data-mention-type=["']user["']/ : /data-mention-type=["']group["']/;
  const ids: string[] = [];
  // Ignore mentions nested inside code blocks / inline code.
  for (const [tag] of stripCodeRegions(htmlContent).matchAll(SPAN_TAG)) {
    if (!typeAttr.test(tag)) continue;
    const id = tag.match(idAttr)?.[2];
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

export function extractUserMentions(htmlContent: string): string[] {
  // Either quote style: Slack blocks/attachments emit single-quoted spans (isStringified).
  return mentionIds(htmlContent, 'user', /data-user-id=(["'])([^"']+)\1/);
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
  return mentionIds(htmlContent, 'group', /data-group-id=(["'])([^"']+)\1/);
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
