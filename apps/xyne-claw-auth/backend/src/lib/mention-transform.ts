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

import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("mention-transform");

const USER_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Za-z0-9 ._\-']+?)\[([A-Za-z0-9_-]{8,64})\]/g;
const GROUP_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Za-z0-9 ._\-']+?)\[group:([A-Za-z0-9_-]{8,64}):([^\]]+)\]/g;
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
      // data-username is REQUIRED by the consumer (backend/src/utils/mentionUtils.ts
      // matches /data-username="([^"]+)"/ and skips any user span without it), so
      // its absence here silently dropped agent/app @mentions from the extracted
      // mention list → createMentionNotifications() never fired. Emit it (mirrors
      // the group span's data-group-name above) so bracketed @Name[userId] mentions
      // notify the user. (F1; F2 = bare @Name in session-less runs, tracked separately.)
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

// Plain `@FirstName` or `@FirstName LastName` (up to 3 capitalised words),
// NOT followed by `[` (so already-bracketed forms are skipped), NOT followed
// by `.<alnum>` (that's a dotted handle like `@Deepak.Kushwaha` — handled by
// the handle pattern below; without this guard we'd match just `@Deepak` and
// could tag the wrong user), NOT a special mention (@channel/@here are
// handled separately), and NOT inside an existing HTML span. We require
// leading word-boundary or whitespace via the `pre` group, same pattern as
// the bracketed regex above.
// Each name word is `[A-Z][A-Za-z'\-]*` (note `*`, not `+`) so a single-letter
// word like the "Q" in "Q Analytics Agent" still matches — names with an
// initial (e.g. "M S Dhoni", "A R Rahman") would otherwise be skipped entirely.
// Over-broad single-letter candidates (e.g. a stray "@I") are harmless: the
// resolver only rewrites a name that resolves to EXACTLY ONE user.
const UNBOUND_USER_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Z][A-Za-z'\-]*(?:\s[A-Z][A-Za-z'\-]*){0,2})(?!\[|<\/|\.[A-Za-z0-9])\b/g;

// `@<email>` shorthand — e.g. `@jone.doe@gmail.com`. Same anti-collision
// rules as the name pattern: NOT followed by `[`, NOT inside an HTML span.
// We deliberately keep this loose (matching common-form emails) rather than
// the full RFC 5322 grammar; downstream lookup tolerates a miss.
const UNBOUND_EMAIL_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})(?!\[|<\/)\b/g;

// Dotted handle shorthand — e.g. `@bowmitha.c`, `@utkarsh.kumar`,
// `@deepak.kushwaha`. This is the username form agents copy out of
// Bitbucket/Jira/PR text; at Juspay it is exactly the email local-part. The
// name pattern above can't match it (lowercase, dots) and the email pattern
// requires a full `@domain.tld`, so without this these mentions silently
// stay plain text. Resolved via `byHandle` (email startsWith `${handle}@`).
// `pre` additionally excludes `@` and `.` so the domain of a full email
// (`@jone.doe@gmail.com`) never matches; trailing lookahead excludes bracketed
// mentions, full emails, and partial backtracking inside longer handle/email
// tokens.
const UNBOUND_HANDLE_MENTION_RE =
  /(^|[^A-Za-z0-9_>@.])@([A-Za-z][A-Za-z0-9_\-]*(?:\.[A-Za-z0-9_\-]+)+)(?!\[|[A-Za-z0-9_.@_\-])/g;

// Group alias shorthand — e.g. `@data-intelligence`. User handles use
// dots and display-name mentions are capitalised, so hyphenated lowercase
// aliases can be resolved without colliding with existing user paths.
const UNBOUND_GROUP_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?!\[|<\/|\.[A-Za-z0-9]|@)\b/g;

const SPECIAL_NAMES = new Set(["channel", "here"]);

export interface MentionLookups {
  /** Resolve `@FirstName [LastName...]` → users with that display name.
   *  Return [] if no match, [single] for clean replace, [a, b, …] to keep
   *  the mention ambiguous and skip rewrite. */
  byName: (name: string) => Promise<Array<{ id: string; name: string }>>;
  /** Resolve `@email@domain.tld` → users with that email. Same shape;
   *  same ambiguity rule. */
  byEmail: (email: string) => Promise<Array<{ id: string; name: string }>>;
  /** Resolve a dotted handle (`@bowmitha.c`) → users whose email local-part
   *  is the handle (email startsWith `${handle}@`). Same ambiguity rule.
   *  Optional for backward compatibility — when absent, handles are left
   *  as plain text. */
  byHandle?: (handle: string) => Promise<Array<{ id: string; name: string }>>;
  /** Resolve a group alias (`@data-intelligence`) → user groups with that
   *  alias. Optional for backward compatibility — when absent, group aliases
   *  are left as plain text. */
  byGroupAlias?: (
    alias: string,
  ) => Promise<Array<{ id: string; name: string; alias?: string | null }>>;
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
 *   `@jone.doe@gmail.com` → byEmail → 1 match → `@<displayName>[userId]`
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
  const handlesToResolve = new Set<string>();
  const groupAliasesToResolve = new Set<string>();
  parts.forEach((p, i) => {
    if (i % 2 !== 0) return; // code fence
    // Emails first — they're strictly more specific than the name pattern,
    // so if a token matches both we treat it as an email.
    for (const m of p.matchAll(UNBOUND_EMAIL_MENTION_RE)) {
      emailsToResolve.add(m[2]!.trim().toLowerCase());
    }
    if (lookups.byGroupAlias) {
      for (const m of p.matchAll(UNBOUND_GROUP_MENTION_RE)) {
        groupAliasesToResolve.add(m[2]!.trim().toLowerCase());
      }
    }
    if (lookups.byHandle) {
      for (const m of p.matchAll(UNBOUND_HANDLE_MENTION_RE)) {
        const handle = m[2]!.trim().toLowerCase();
        // A full email also matches the handle pattern up to its `@` — the
        // trailing lookahead blocks that, but be defensive about overlap.
        if (emailsToResolve.has(handle)) continue;
        handlesToResolve.add(handle);
      }
    }
    for (const m of p.matchAll(UNBOUND_USER_MENTION_RE)) {
      const name = m[2]!.trim();
      if (SPECIAL_NAMES.has(name.toLowerCase())) continue;
      namesToResolve.add(name);
    }
  });

  // DIAG: what the unbound regexes matched. If a `@email`/`@Name` you expected
  // isn't here, the regex didn't match it (token shape / surrounding chars); if
  // it IS here but later byEmail logs 0 matches, the lookup (DB reader / scope)
  // is the failure point.
  log.info(
    `[mention] collected emails=[${[...emailsToResolve].join(",")}] names=[${[...namesToResolve].join(",")}] handles=[${[...handlesToResolve].join(",")}] groups=[${[...groupAliasesToResolve].join(",")}]`,
  );

  if (
    namesToResolve.size === 0 &&
    emailsToResolve.size === 0 &&
    handlesToResolve.size === 0 &&
    groupAliasesToResolve.size === 0
  ) {
    log.info("[mention] no unbound mention candidates matched");
    return input;
  }

  // Resolve names + emails in parallel — one HTTP call per distinct input.
  // Map values are `{ id, displayName }` so the email path can substitute
  // the email with the real display name in the rendered chip.
  const resolvedByName = new Map<string, { id: string; displayName: string }>();
  const resolvedByEmail = new Map<
    string,
    { id: string; displayName: string }
  >();
  const resolvedByHandle = new Map<
    string,
    { id: string; displayName: string }
  >();
  const resolvedByGroupAlias = new Map<
    string,
    { id: string; name: string; alias: string }
  >();
  await Promise.all([
    ...[...namesToResolve].map(async (name) => {
      try {
        const matches = await lookups.byName(name);
        log.info(`[mention] byName "${name}" -> ${matches.length} match(es)${matches.length === 1 ? ` id=${matches[0]?.id}` : ""}`);
        if (matches.length === 1 && matches[0]?.id) {
          resolvedByName.set(name, {
            id: matches[0].id,
            displayName: matches[0].name || name,
          });
        }
      } catch (err) {
        log.warn(`[mention] byName "${name}" threw: ${errMsg(err)}`);
        // Swallow per-name failures so one bad lookup doesn't kill the post.
      }
    }),
    ...[...emailsToResolve].map(async (email) => {
      try {
        const matches = await lookups.byEmail(email);
        // DIAG: byEmail needs EXACTLY one match (query is LIMIT 2) — 0 (not found
        // / wrong reader) or 2 (dupes) leaves the mention unresolved. Logs the
        // count so we can see whether the lookup is the failure point.
        log.info(`[mention] byEmail "${email}" → ${matches.length} match(es)${matches.length === 1 ? ` id=${matches[0]?.id}` : ""}`);
        if (matches.length === 1 && matches[0]?.id) {
          resolvedByEmail.set(email, {
            id: matches[0].id,
            displayName: matches[0].name || email,
          });
        }
      } catch (err) {
        log.warn(`[mention] byEmail "${email}" threw: ${errMsg(err)}`);
      }
    }),
    ...[...handlesToResolve].map(async (handle) => {
      try {
        const matches = await lookups.byHandle!(handle);
        log.info(`[mention] byHandle "${handle}" -> ${matches.length} match(es)${matches.length === 1 ? ` id=${matches[0]?.id}` : ""}`);
        if (matches.length === 1 && matches[0]?.id) {
          resolvedByHandle.set(handle, {
            id: matches[0].id,
            displayName: matches[0].name || handle,
          });
        }
      } catch (err) {
        log.warn(`[mention] byHandle "${handle}" threw: ${errMsg(err)}`);
        // Same fallthrough as above.
      }
    }),
    ...[...groupAliasesToResolve].map(async (alias) => {
      try {
        const matches = await lookups.byGroupAlias!(alias);
        log.info(`[mention] byGroupAlias "${alias}" -> ${matches.length} match(es)${matches.length === 1 ? ` id=${matches[0]?.id}` : ""}`);
        if (matches.length === 1 && matches[0]?.id) {
          resolvedByGroupAlias.set(alias, {
            id: matches[0].id,
            name: matches[0].name || alias,
            alias: matches[0].alias || alias,
          });
        }
      } catch (err) {
        log.warn(`[mention] byGroupAlias "${alias}" threw: ${errMsg(err)}`);
        // Same fallthrough as above.
      }
    }),
  ]);

  log.info(
    `[mention] resolved names=${resolvedByName.size}/${namesToResolve.size} emails=${resolvedByEmail.size}/${emailsToResolve.size} handles=${resolvedByHandle.size}/${handlesToResolve.size} groups=${resolvedByGroupAlias.size}/${groupAliasesToResolve.size}`,
  );

  // Second pass: rewrite non-code segments. Apply email rewrites BEFORE
  // handle rewrites BEFORE name rewrites — most-specific-first, same
  // precedence reason as the collection pass above.
  return parts
    .map((p, i) => {
      if (i % 2 !== 0) return p;
      let out = p.replace(
        UNBOUND_EMAIL_MENTION_RE,
        (_match, pre: string, email: string) => {
          const lower = email.trim().toLowerCase();
          const hit = resolvedByEmail.get(lower);
          return hit ? `${pre}@${hit.displayName}[${hit.id}]` : _match;
        },
      );
      out = out.replace(
        UNBOUND_HANDLE_MENTION_RE,
        (_match, pre: string, handle: string) => {
          const hit = resolvedByHandle.get(handle.trim().toLowerCase());
          return hit ? `${pre}@${hit.displayName}[${hit.id}]` : _match;
        },
      );
      out = out.replace(
        UNBOUND_GROUP_MENTION_RE,
        (_match, pre: string, alias: string) => {
          const hit = resolvedByGroupAlias.get(alias.trim().toLowerCase());
          return hit
            ? `${pre}@${hit.alias}[group:${hit.id}:${hit.name}]`
            : _match;
        },
      );
      out = out.replace(
        UNBOUND_USER_MENTION_RE,
        (_match, pre: string, name: string) => {
          const trimmed = name.trim();
          if (SPECIAL_NAMES.has(trimmed.toLowerCase())) return _match;
          const hit = resolvedByName.get(trimmed);
          return hit ? `${pre}@${hit.displayName}[${hit.id}]` : _match;
        },
      );
      return out;
    })
    .join("");
}
