import {
  BRIEF_TICKET_SCHEME,
  CLAW_CITATION_MALFORMED_RE,
  CLAW_CITATION_TOKEN_RE,
  createClawCitationRunScanner,
  parseClawCitationTokenBody,
  type ClawCiteRef,
} from './citations';

/**
 * Per-line brief text pipeline.
 * Ported from dashboard/src/routes/DailyBriefScreen/briefText.tsx — the pure
 * string half, adapted for the native renderer:
 *
 *   - `<@userId>` mentions → `[@Name](xyne://user/<id>)` inline links
 *   - `<#channelId>` mentions → `[#name](xyne://channel/<id>)` inline links
 *   - bare ticket ids (ABC-123) → `[ABC-123](xyne-ticket://ABC-123)` when the
 *     prefix matches a real project code
 *   - `[clf-<toolCallId>#<N>]` citation tokens are EXTRACTED, not linkified:
 *     native markdown text cannot host the web's icon chips inline, so runs of
 *     adjacent tokens come back as `citationRuns` and render as real chip
 *     components after the line (matching the web's trailing-chip look).
 */

const MENTION_TOKEN_RE = /<@([A-Za-z0-9_-]+)>/g;
const CHANNEL_TOKEN_RE = /<#([A-Za-z0-9_-]+)>/g;
const TICKET_ID_RE = /\b([A-Z0-9]{2,10})-(\d{1,6})\b/g;
const MARKDOWN_LINK_RE = /\[[^\]]*\]\([^)]*\)/g;

export const MENTION_USER_SCHEME = 'xyne://user/';
export const MENTION_CHANNEL_SCHEME = 'xyne://channel/';

export type RoutableCheck = (toolCallId: string, chunkIndex: number) => boolean;

export interface BriefLineContext {
  /** Whether a citation token resolves to something with a buildable URL. */
  isRoutable: RoutableCheck;
  /** Upper-cased project codes; empty set disables ticket linkification. */
  ticketPrefixes: ReadonlySet<string>;
  /** Display name for a mentioned user id (null → generic label). */
  resolveUserName: (userId: string) => string | null;
  /** Channel name for a mentioned channel id (null → the raw id). */
  resolveChannelName: (channelId: string) => string | null;
}

export interface PreparedBriefLine {
  /** Markdown for the line's prose, or null when nothing survives. */
  markdown: string | null;
  /** Citation chips: one entry per run of adjacent tokens — a singleton run
   *  renders a labeled chip, a longer run renders a "+N" cluster. */
  citationRuns: ClawCiteRef[][];
}

export function tidy(line: string): string {
  return line
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

export function stripCitationTokens(line: string): string {
  return tidy(line.replace(CLAW_CITATION_MALFORMED_RE, ''));
}

export function dropUnresolvableTokens(line: string, isRoutable: RoutableCheck): string {
  return line.replace(CLAW_CITATION_TOKEN_RE, (token, _open, body: string) => {
    const ref = parseClawCitationTokenBody(body);
    return ref && isRoutable(ref.toolCallId, ref.chunkIndex) ? token : '';
  });
}

/**
 * Pull citation tokens OUT of the line, grouping runs of adjacent tokens
 * (separated only by spaces/tabs — never across line breaks, so list items
 * keep their own chips). Mirrors the web's `linkifyAndGroupClawCitations`
 * grouping rule, but returns structured refs instead of markdown links.
 */
export function extractCitationRuns(line: string): { text: string; runs: ClawCiteRef[][] } {
  if (!line || line.indexOf('clf-') === -1) return { text: line, runs: [] };
  const { runRe, tokenRe } = createClawCitationRunScanner();
  const runs: ClawCiteRef[][] = [];
  const text = line.replace(runRe, run => {
    tokenRe.lastIndex = 0;
    const refs: ClawCiteRef[] = [];
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(run)) !== null) {
      const body = m[2];
      if (!body) continue;
      const ref = parseClawCitationTokenBody(body);
      if (ref) refs.push(ref);
    }
    if (refs.length > 0) runs.push(refs);
    return '';
  });
  return { text, runs };
}

/** Square brackets or parens inside a markdown link label/target break the link. */
function escapeLinkLabel(label: string): string {
  return label.replace(/([\\[\]])/g, '\\$1').replace(/[()]/g, '');
}

/** Ticket ids inside an existing markdown link (a citation, or a plain URL
 *  that carries a ticket key) must be left alone — rewriting them nests one
 *  link inside another and the markdown breaks. */
export function linkifyTicketIds(line: string, ticketPrefixes: ReadonlySet<string>): string {
  if (ticketPrefixes.size === 0) return line;
  const replaceOutsideLinks = (text: string): string =>
    text.replace(TICKET_ID_RE, (match, prefix: string) =>
      ticketPrefixes.has(prefix) ? `[${match}](${BRIEF_TICKET_SCHEME}${match})` : match,
    );

  const out: string[] = [];
  let cursor = 0;
  for (const link of line.matchAll(MARKDOWN_LINK_RE)) {
    const start = link.index ?? 0;
    out.push(replaceOutsideLinks(line.slice(cursor, start)), link[0]);
    cursor = start + link[0].length;
  }
  out.push(replaceOutsideLinks(line.slice(cursor)));
  return out.join('');
}

export function linkifyMentions(line: string, context: BriefLineContext): string {
  const withMentions = line
    .replace(MENTION_TOKEN_RE, (_token, userId: string) => {
      const name = context.resolveUserName(userId);
      const label = escapeLinkLabel(name ? `@${name}` : '@member');
      return `[${label}](${MENTION_USER_SCHEME}${userId})`;
    })
    .replace(CHANNEL_TOKEN_RE, (_token, channelId: string) => {
      const name = context.resolveChannelName(channelId);
      const label = escapeLinkLabel(`#${name ?? channelId}`);
      return `[${label}](${MENTION_CHANNEL_SCHEME}${channelId})`;
    });
  return linkifyTicketIds(withMentions, context.ticketPrefixes);
}

/**
 * Full pipeline for one brief line: drop unroutable citation tokens, extract
 * the routable ones as chip runs, strip malformed leftovers, then linkify
 * mentions and ticket ids in the remaining prose.
 */
export function prepareBriefLine(line: string, context: BriefLineContext): PreparedBriefLine {
  const { text, runs } = extractCitationRuns(dropUnresolvableTokens(line, context.isRoutable));
  const prose = linkifyMentions(stripCitationTokens(text), context);
  return { markdown: prose.trim() ? prose : null, citationRuns: runs };
}
