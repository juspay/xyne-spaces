/**
 * Mention shorthand in message content, expanded to the markup Spaces reads.
 *
 * A message mentions someone only when its content carries the composer's span
 * (`mentionParser.ts` reads `data-user-id` and `data-username` from it); plain `@Name`
 * text renders but never notifies. API callers write the shorthand Claw agents write, and
 * it is expanded before the mutator runs: by the SDK API for plaintext fields, and by the
 * client (SDK, or the dashboard relaying an artifact app) before it encrypts a field.
 * The patterns and the markup mirror `apps/xyne-claw-auth/backend/src/lib/mention-transform.ts`,
 * so a mention from any path is indistinguishable from one typed in the app.
 *
 *   @Name[userId]                       → user mention
 *   @Alias[group:GROUP_ID:Group Name]   → group mention
 *   @channel, @here                     → channel-wide special mention
 *
 * Deterministic and synchronous: an id is taken as given, never looked up, so a wrong id
 * simply notifies nobody. Content already in span form is left alone, which makes expansion
 * idempotent. Code (``` fences, <pre>, <code>) is skipped, so text that shows the shorthand
 * is not turned into a ping.
 */

const USER_MENTION_RE = /(^|[^A-Za-z0-9_>])@([A-Za-z0-9 ._\-']+?)\[([A-Za-z0-9_-]{8,64})\]/g;
const GROUP_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Za-z0-9 ._\-']+?)\[group:([A-Za-z0-9_-]{8,64}):([^\]]+)\]/g;
const SPECIAL_MENTION_RE = /(^|[^A-Za-z0-9_>])@(channel|here)\b/g;

/** Code regions, kept verbatim. Capturing, so `split` keeps them at odd indexes. */
const CODE_REGION_RE = /(```[\s\S]*?```|<pre\b[\s\S]*?<\/pre>|<code\b[\s\S]*?<\/code>)/gi;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function expandSegment(text: string): string {
  // Groups first: `@Alias[group:…]` would otherwise half-match the user pattern.
  return text
    .replace(GROUP_MENTION_RE, (_m, pre: string, alias: string, groupId: string, name: string) => {
      const cleanAlias = escapeAttr(alias.trim());
      return `${pre}<span data-mention="" data-mention-type="group" data-group-id="${escapeAttr(groupId)}" data-group-name="${escapeAttr(name.trim())}" data-group-alias="${cleanAlias}" class="chat-input-mention">@${cleanAlias}</span>`;
    })
    .replace(USER_MENTION_RE, (_m, pre: string, name: string, userId: string) => {
      const cleanName = escapeAttr(name.trim());
      return `${pre}<span data-mention="" data-mention-type="user" data-user-id="${escapeAttr(userId)}" data-username="${cleanName}" class="chat-input-mention">@${cleanName}</span>`;
    })
    .replace(
      SPECIAL_MENTION_RE,
      (_m, pre: string, kind: string) =>
        `${pre}<span data-mention="" data-mention-type="${kind}" class="chat-input-special-mention">@${kind}</span>`,
    );
}

/** Expand mention shorthand in `content`. */
export function expandMentionShorthand(content: string): string {
  if (!content.includes('@')) return content;
  return content
    .split(CODE_REGION_RE)
    .map((part, i) => (i % 2 === 0 ? expandSegment(part) : part))
    .join('');
}
