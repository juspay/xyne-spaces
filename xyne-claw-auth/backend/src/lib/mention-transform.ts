/**
 * Server-side expansion of agent-emitted mention shorthand into the HTML
 * span format Spaces needs to render a clickable, notifying mention.
 *
 * Why this exists: when we relied on the LLM to emit the full HTML span
 * verbatim (per the run-time SPACES_MENTION_GUIDE), agents intermittently
 * fell back to plain shorthand like `@Name[userId]` or `@Name (userId)` —
 * which renders as plain text and never notifies. Tagging needs to be
 * deterministic; a regex on the server is.
 *
 * Shorthand the agent may produce (any of these is expanded):
 *   @Name[userId]                       → user mention
 *   @Alias[group:GROUP_ID:Group Name]   → group mention
 *   @channel                            → channel-wide special mention
 *   @here                               → active-members special mention
 *
 * Anything already in the long-form HTML span is left untouched (idempotent
 * for mixed input). Fenced code blocks (```…```) are also skipped.
 */

const USER_MENTION_RE = /(^|[^A-Za-z0-9_>])@([A-Za-z0-9 ._\-']+?)\[([A-Za-z0-9_-]{8,64})\]/g;
const GROUP_MENTION_RE = /(^|[^A-Za-z0-9_>])@([A-Za-z0-9 ._\-']+?)\[group:([A-Za-z0-9_-]{8,64}):([^\]]+)\]/g;
const SPECIAL_MENTION_RE = /(^|[^A-Za-z0-9_>])@(channel|here)\b/g;

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
  let out = s.replace(GROUP_MENTION_RE, (_match, pre: string, alias: string, gid: string, name: string) => {
    const cleanAlias = alias.trim();
    const cleanName = name.trim();
    return `${pre}<span data-mention="" data-mention-type="group" data-group-id="${escapeAttr(gid)}" data-group-name="${escapeAttr(cleanName)}" data-group-alias="${escapeAttr(cleanAlias)}" class="chat-input-mention">@${escapeAttr(cleanAlias)}</span>`;
  });

  out = out.replace(USER_MENTION_RE, (_match, pre: string, name: string, uid: string) => {
    const cleanName = name.trim();
    return `${pre}<span data-mention="" data-mention-type="user" data-user-id="${escapeAttr(uid)}" class="chat-input-mention">@${escapeAttr(cleanName)}</span>`;
  });

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

// Plain `@FirstName` or `@FirstName LastName` (up to 3 capitalised words),
// NOT followed by `[` (so already-bracketed forms are skipped), NOT a special
// mention (@channel/@here are handled separately), and NOT inside an existing
// HTML span. We require leading word-boundary or whitespace via the `pre`
// group, same pattern as the bracketed regex above.
const UNBOUND_USER_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Z][A-Za-z'\-]+(?:\s[A-Z][A-Za-z'\-]+){0,2})(?!\[|<\/)\b/g;

// `@<email>` shorthand — e.g. `@john.doe@gmail.com`. Same anti-collision
// rules as the name pattern: NOT followed by `[`, NOT inside an HTML span.
// We deliberately keep this loose (matching common-form emails) rather than
// the full RFC 5322 grammar; downstream lookup tolerates a miss.
const UNBOUND_EMAIL_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})(?!\[|<\/)\b/g;

const SPECIAL_NAMES = new Set(["channel", "here"]);

export interface MentionLookups {
  /** Resolve `@FirstName [LastName...]` → users with that display name.
   *  Return [] if no match, [single] for clean replace, [a, b, …] to keep
   *  the mention ambiguous and skip rewrite. */
  byName: (name: string) => Promise<Array<{ id: string; name: string }>>;
  /** Resolve `@email@domain.tld` → users with that email. Same shape;
   *  same ambiguity rule. */
  byEmail: (email: string) => Promise<Array<{ id: string; name: string }>>;
}

/**
 * Resolve plain `@Name` AND `@email@domain.tld` patterns (NOT already in
 * `@Name[userId]` form) by calling the provided lookups once per unique
 * input. When a lookup returns EXACTLY ONE match, the segment is replaced
 * with the bracketed form so the downstream `expandSpacesMentions` can
 * lift it into the HTML span.
 *
 * Name path:
 *   `@Anirudh Naruka`         →  byName → 1 match  →  `@Anirudh Naruka[userId]`
 *   `@Anirudh`                →  byName → 2 matches →  left as-is (ambiguous)
 *
 * Email path:
 *   `@john.doe@gmail.com` → byEmail → 1 match → `@<displayName>[userId]`
 *                                                     (the visible label
 *                                                     becomes the user's
 *                                                     real name, not the
 *                                                     email — Spaces UI
 *                                                     shows the name in the
 *                                                     chip)
 *
 * Skipped: `@channel` / `@here`, already-bracketed forms, fenced code blocks.
 *
 * Why this lives in a separate function (instead of folding into
 * `expandSpacesMentions`): the static expander is sync + zero-dep, used in
 * every post path. The async resolver needs HTTP and is only called from
 * the webhook-result path. Keeping them split means non-result callers
 * keep the cheap sync path.
 */
export async function resolveUnboundMentions(
  input: string,
  lookups: MentionLookups,
): Promise<string> {
  if (!input) return "";

  // First pass: collect distinct names + emails that need lookup, across
  // all non-code segments. Same input appearing N times → 1 API call.
  const parts = input.split(/(```[\s\S]*?```)/g);
  const namesToResolve = new Set<string>();
  const emailsToResolve = new Set<string>();
  parts.forEach((p, i) => {
    if (i % 2 !== 0) return; // code fence
    // Emails first — they're strictly more specific than the name pattern,
    // so if a token matches both we treat it as an email.
    for (const m of p.matchAll(UNBOUND_EMAIL_MENTION_RE)) {
      emailsToResolve.add(m[2]!.trim().toLowerCase());
    }
    for (const m of p.matchAll(UNBOUND_USER_MENTION_RE)) {
      const name = m[2]!.trim();
      if (SPECIAL_NAMES.has(name.toLowerCase())) continue;
      namesToResolve.add(name);
    }
  });

  if (namesToResolve.size === 0 && emailsToResolve.size === 0) return input;

  // Resolve names + emails in parallel — one HTTP call per distinct input.
  // Map values are `{ id, displayName }` so the email path can substitute
  // the email with the real display name in the rendered chip.
  const resolvedByName = new Map<string, { id: string; displayName: string }>();
  const resolvedByEmail = new Map<string, { id: string; displayName: string }>();
  await Promise.all([
    ...[...namesToResolve].map(async (name) => {
      try {
        const matches = await lookups.byName(name);
        if (matches.length === 1 && matches[0]?.id) {
          resolvedByName.set(name, { id: matches[0].id, displayName: matches[0].name || name });
        }
      } catch {
        // Swallow per-name failures so one bad lookup doesn't kill the post.
      }
    }),
    ...[...emailsToResolve].map(async (email) => {
      try {
        const matches = await lookups.byEmail(email);
        if (matches.length === 1 && matches[0]?.id) {
          resolvedByEmail.set(email, { id: matches[0].id, displayName: matches[0].name || email });
        }
      } catch {
        // Same fallthrough as above.
      }
    }),
  ]);

  // Second pass: rewrite non-code segments. Apply email rewrites BEFORE name
  // rewrites — same precedence reason as the collection pass above.
  return parts.map((p, i) => {
    if (i % 2 !== 0) return p;
    let out = p.replace(UNBOUND_EMAIL_MENTION_RE, (_match, pre: string, email: string) => {
      const lower = email.trim().toLowerCase();
      const hit = resolvedByEmail.get(lower);
      return hit ? `${pre}@${hit.displayName}[${hit.id}]` : _match;
    });
    out = out.replace(UNBOUND_USER_MENTION_RE, (_match, pre: string, name: string) => {
      const trimmed = name.trim();
      if (SPECIAL_NAMES.has(trimmed.toLowerCase())) return _match;
      const hit = resolvedByName.get(trimmed);
      return hit ? `${pre}@${hit.displayName}[${hit.id}]` : _match;
    });
    return out;
  }).join("");
}
