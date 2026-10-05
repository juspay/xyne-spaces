/**
 * Server-side expansion of bot/app-emitted mention shorthand into the HTML
 * span format Spaces needs to render a clickable, notifying mention.
 *
 * Why this exists: APP-type senders (e.g. TARA `tara@app.xyne.ai`) post into
 * Spaces through their own integrations. Their content never passes through
 * xyne-claw-auth's mention transform (which already lifts `@Name[userId]`
 * shorthand for claw-delivered messages), so shorthand renders as plain text
 * and never notifies. The expansion runs at the single chat message-save
 * funnel (MessageRepository.create / createWithExecutionId), gated to
 * non-human senders so the human composer path — which already emits real
 * spans — is untouched.
 *
 * Shorthand expanded (same semantics as the claw-auth transform):
 *   @Name[userId]                       → user mention
 *   @Alias[group:GROUP_ID:Group Name]   → group mention
 *   @channel                            → channel-wide special mention
 *   @here                               → active-members special mention
 *   <@userId>  (Slack-style token)      → resolved to the ACTIVE human with
 *                                         that exact id, then lifted like
 *                                         @Name[userId]. The id is
 *                                         authoritative (primary key). 0 or
 *                                         ≥2 matches ⇒ left as-is — never a
 *                                         false ping.
 *
 * Anything already in the long-form HTML span is left untouched (idempotent
 * for mixed input). Fenced code blocks (```…```) are also skipped.
 *
 * Kept dependency-free and callback-driven so it is unit-testable without a
 * database; the repository wires the prisma lookups.
 */

const USER_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Za-z0-9 ._\-']+?)\[([A-Za-z0-9_-]{8,64})\]/g;
const GROUP_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Za-z0-9 ._\-']+?)\[group:([A-Za-z0-9_-]{8,64}):([^\]]+)\]/g;
const SPECIAL_MENTION_RE = /(^|[^A-Za-z0-9_>])@(channel|here)\b/g;

// Slack-style user token — `<@userId>`. Integrations trained on Slack (or
// carrying a stale "Slack chip-mention convention" memory) emit this form;
// Spaces never parsed it, so it rendered as literal `<@u3a13b5...>` text.
const SLACK_USER_TOKEN_RE = /<@([A-Za-z0-9_-]{4,64})>/g;

/**
 * Cheap synchronous pre-check for the repository save path: does the content
 * even look like mention shorthand? Non-matching content (the overwhelmingly
 * common case) skips both the sender lookup and the expansion passes — zero
 * added cost for messages without any mention-shaped token.
 */
export const BOT_MENTION_PRECHECK_RE =
  /<@[A-Za-z0-9_-]{4,64}>|@[A-Za-z0-9 ._\-']{1,80}\[[A-Za-z0-9_-]{8,64}\]/;

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function transformSegment(s: string): string {
  // Group mentions first — strictly more specific than the user pattern
  // (both have @Name[…] but only group has the literal `group:` prefix).
  let out = s.replace(
    GROUP_MENTION_RE,
    (_match, pre: string, alias: string, gid: string, name: string) => {
      const cleanAlias = alias.trim();
      const cleanName = name.trim();
      return `${pre}<span data-mention="" data-mention-type="group" data-group-id="${escapeAttr(gid)}" data-group-name="${escapeAttr(cleanName)}" data-group-alias="${escapeAttr(cleanAlias)}" class="chat-input-mention">@${escapeAttr(cleanAlias)}</span>`;
    },
  );

  out = out.replace(
    USER_MENTION_RE,
    (_match, pre: string, name: string, uid: string) => {
      const cleanName = name.trim();
      // data-username is REQUIRED by the consumer (src/utils/mentionUtils.ts
      // matches /data-username="([^"]+)"/ and skips any user span without it);
      // without it the mention is extracted for notifications but never fires.
      return `${pre}<span data-mention="" data-mention-type="user" data-user-id="${escapeAttr(uid)}" data-username="${escapeAttr(cleanName)}" class="chat-input-mention">@${escapeAttr(cleanName)}</span>`;
    },
  );

  out = out.replace(SPECIAL_MENTION_RE, (_match, pre: string, kind: string) => {
    return `${pre}<span data-mention="" data-mention-type="${kind}" class="chat-input-special-mention">@${kind}</span>`;
  });

  return out;
}

/**
 * Expand all mention shorthand in `input`. Idempotent — re-running on an
 * already-expanded string returns the same string. Code fences are not
 * transformed (so docs that show the literal shorthand don't get mangled).
 */
export function expandSpacesMentions(input: string | undefined | null): string {
  if (!input) return "";
  // Split on triple-backtick fences. Odd-indexed parts are code blocks → leave alone.
  const parts = input.split(/(```[\s\S]*?```)/g);
  return parts.map((p, i) => (i % 2 === 0 ? transformSegment(p) : p)).join("");
}

export type MentionUserByIdLookup = (
  id: string,
) => Promise<Array<{ id: string; name: string }>>;

/**
 * Full bot-sender expansion pass:
 *   1. Resolve Slack-style `<@userId>` tokens via `byId` (exactly-one ACTIVE
 *      human rule) and rewrite them to `@DisplayName[userId]`.
 *   2. Lift every bracketed form into the HTML span via expandSpacesMentions.
 *
 * The rewrite runs BEFORE the lift deliberately: the lift is idempotent, so
 * a token that failed resolution (still literal `<@id>`) simply passes
 * through untouched. Lookup failures are swallowed — the token stays as-is,
 * the message still saves.
 */
export async function expandBotMentionShorthand(
  input: string,
  byId: MentionUserByIdLookup,
): Promise<string> {
  if (!input) return input;

  const parts = input.split(/(```[\s\S]*?```)/g);

  // Collect distinct ids across non-fence segments (N repeats → 1 lookup).
  const idsToResolve = new Set<string>();
  parts.forEach((p, i) => {
    if (i % 2 !== 0) return; // code fence
    for (const m of p.matchAll(SLACK_USER_TOKEN_RE)) {
      idsToResolve.add(m[1]!.trim());
    }
  });

  const resolvedById = new Map<string, { id: string; displayName: string }>();
  await Promise.all(
    [...idsToResolve].map(async (id) => {
      try {
        const matches = await byId(id);
        if (matches.length === 1 && matches[0]?.id) {
          resolvedById.set(id, { id: matches[0].id, displayName: matches[0].name });
        }
      } catch {
        // Lookup failure ⇒ leave the token as-is; never block the save.
      }
    }),
  );

  const rewritten = parts
    .map((p, i) => {
      if (i % 2 !== 0) return p;
      return p.replace(SLACK_USER_TOKEN_RE, (_match, uid: string) => {
        const hit = resolvedById.get(uid.trim());
        return hit ? `@${hit.displayName}[${hit.id}]` : _match;
      });
    })
    .join("");

  return expandSpacesMentions(rewritten);
}
