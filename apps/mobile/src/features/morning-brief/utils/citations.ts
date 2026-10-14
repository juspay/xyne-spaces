import type { BriefCitation, BriefToolInvocation } from '../api/dailyBriefApi';

/**
 * Desk channel types — EMAIL, SLACK and APP channels all feed into Xyne Desk.
 * Inlined from @xyne/shared's `isDeskChannelType`: importing the shared index
 * here would pull the whole Zero schema into this otherwise dependency-free
 * module (and into every test that touches it).
 */
const DESK_CHANNEL_TYPES: ReadonlySet<string> = new Set(['EMAIL', 'SLACK', 'APP']);

function isDeskChannelType(type: string | null | undefined): boolean {
  return type !== null && type !== undefined && DESK_CHANNEL_TYPES.has(type);
}

/**
 * Ported from dashboard/src/components/Chat/XyneAISidebar/utils/clawCitationUrl.ts
 * and the pure citation helpers in components/ui/TipTapExtensions/CitationMark.ts.
 * URL builders emit DASHBOARD-relative paths; the tap handler maps the citation
 * kind onto native routes first and only falls back to those paths.
 */

/** v3 claw inline-citation token: `[clf-<toolCallId>#<chunkIndex>]` (plus the
 *  fullwidth-bracket variants the LLM occasionally emits). No trailing `\s?` —
 *  tokens sit at end-of-line in markdown lists and eating the `\n` collapses
 *  the list. */
export const CLAW_CITATION_TOKEN_RE = /([【[⟦])(clf-[A-Za-z0-9_.:-]+#\d+)([】\]⟧])/g;

/** Lenient catch-all for malformed clf tokens the LLM sometimes hallucinates. */
export const CLAW_CITATION_MALFORMED_RE = /[【[⟦]\s*clf-[^】\]⟧]*[】\]⟧]/g;

/** Link schemes the prepared brief markdown uses. The renderer styles them via
 *  `linkVariants` and the screen dispatches taps by prefix. */
export const BRIEF_CITE_SCHEME = 'xyne-cite://';
export const BRIEF_CITE_GROUP_SCHEME = 'xyne-cite-group://';
export const BRIEF_TICKET_SCHEME = 'xyne-ticket://';

export interface ClawCiteRef {
  toolCallId: string;
  chunkIndex: number;
}

/** Parse the `clf-<toolCallId>#<N>` body of a citation token. Single owner of
 *  this logic — briefText.ts imports it rather than keeping its own copy. */
export function parseClawCitationTokenBody(body: string): ClawCiteRef | null {
  if (!body.startsWith('clf-')) return null;
  const rest = body.slice('clf-'.length);
  const hashIdx = rest.lastIndexOf('#');
  if (hashIdx <= 0) return null;
  const toolCallId = rest.slice(0, hashIdx);
  const chunkIndex = Number(rest.slice(hashIdx + 1));
  if (!toolCallId || !Number.isFinite(chunkIndex)) return null;
  return { toolCallId, chunkIndex };
}

const CLAW_CITATION_TOKEN_SRC = '[【\\[⟦]clf-[A-Za-z0-9_.:-]+#\\d+[】\\]⟧]';

/**
 * Fresh stateful (`/g`) regexes for scanning runs of adjacent citation tokens
 * (separated only by spaces/tabs). A factory rather than shared constants —
 * `lastIndex` makes shared `/g` instances hazardous across callers. Used by
 * both linkifyAndGroupClawCitations here and extractCitationRuns in
 * briefText.ts, which must stay in lockstep on what counts as a "run".
 */
export function createClawCitationRunScanner(): { runRe: RegExp; tokenRe: RegExp } {
  return {
    runRe: new RegExp(`${CLAW_CITATION_TOKEN_SRC}(?:[ \\t]*${CLAW_CITATION_TOKEN_SRC})*`, 'g'),
    tokenRe: new RegExp(CLAW_CITATION_TOKEN_RE.source, 'g'),
  };
}

/** Parse a `xyne-cite://clf-…#N` href. */
export function parseCiteHref(href: string): ClawCiteRef | null {
  if (!href.startsWith(BRIEF_CITE_SCHEME)) return null;
  return parseClawCitationTokenBody(href.slice(BRIEF_CITE_SCHEME.length));
}

/** Parse a `xyne-cite-group://clf-a#1,clf-b#2,…` href into its refs. */
export function parseCiteGroupHref(href: string): ClawCiteRef[] {
  if (!href.startsWith(BRIEF_CITE_GROUP_SCHEME)) return [];
  const refs: ClawCiteRef[] = [];
  for (const raw of href.slice(BRIEF_CITE_GROUP_SCHEME.length).split(',')) {
    const ref = parseClawCitationTokenBody(raw.trim());
    if (ref) refs.push(ref);
  }
  return refs;
}

/**
 * Build a stable display-number map (`toolCallId` → 1, 2, 3 …) following the
 * order tokens appear in the rendered markdown — so the first tool the model
 * cites is always shown as "1.x" regardless of execution order.
 */
export function buildClawCitationToolNumbers(content: string): Map<string, number> {
  const numbers = new Map<string, number>();
  if (!content || content.indexOf('clf-') === -1) return numbers;
  const re = new RegExp(CLAW_CITATION_TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const body = m[2];
    if (!body) continue;
    const ref = parseClawCitationTokenBody(body);
    if (ref && !numbers.has(ref.toolCallId)) numbers.set(ref.toolCallId, numbers.size + 1);
  }
  return numbers;
}

/**
 * Replace citation tokens with `[n.m](xyne-cite://…)` links, GROUPING runs of
 * 2+ adjacent tokens (separated only by spaces/tabs) into a single
 * `[+N](xyne-cite-group://…)` link. Mirrors the web's
 * `linkifyAndGroupClawCitations`, with the `cite:`/`cite-group:` hrefs swapped
 * for URL schemes the native markdown renderer accepts.
 */
export function linkifyAndGroupClawCitations(
  content: string,
  toolNumbers: ReadonlyMap<string, number>,
): string {
  if (!content || content.indexOf('clf-') === -1) return content;
  const { runRe, tokenRe } = createClawCitationRunScanner();
  return content.replace(runRe, run => {
    tokenRe.lastIndex = 0;
    const resolved: Array<{ body: string; toolNumber: number; chunkIndex: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(run)) !== null) {
      const body = m[2];
      if (!body) continue;
      const ref = parseClawCitationTokenBody(body);
      if (!ref) continue;
      const toolNumber = toolNumbers.get(ref.toolCallId);
      if (!toolNumber) continue; // unknown tool — drop, matches strip behavior
      resolved.push({ body, toolNumber, chunkIndex: ref.chunkIndex });
    }
    const [first] = resolved;
    if (!first) return run; // left for the malformed-strip pass
    if (resolved.length === 1) {
      return `[${first.toolNumber}.${first.chunkIndex}](${BRIEF_CITE_SCHEME}${first.body})`;
    }
    const bodies = resolved.map(r => r.body).join(',');
    return `[+${resolved.length}](${BRIEF_CITE_GROUP_SCHEME}${bodies})`;
  });
}

/**
 * Resolve a citation token to the structured citation carried on the matching
 * tool invocation. Falls back to the invocation's first citation when the
 * chunkIndex has no exact match (older single-resource tools).
 */
export function findCitationForChunk(
  toolInvocations: BriefToolInvocation[] | undefined,
  toolCallId: string,
  chunkIndex: number,
): BriefCitation | null {
  if (!toolInvocations || toolInvocations.length === 0) return null;
  const invocation = toolInvocations.find(t => t.toolCallId === toolCallId);
  if (!invocation || !invocation.citations) return null;
  const exact = invocation.citations.find(c => c.chunkIndex === chunkIndex);
  if (exact) return exact;
  return invocation.citations[0] ?? null;
}

function buildSupportPath(
  channelId: string,
  xyneId: string,
  conversationId?: string,
  ticketId?: string,
  mailId?: string,
): string {
  const params: string[] = [];
  if (conversationId) params.push(`conversationId=${encodeURIComponent(conversationId)}`);
  if (ticketId) params.push(`ticketId=${encodeURIComponent(ticketId)}`);
  if (mailId) params.push(`mail=${encodeURIComponent(mailId)}`);
  const base = `/support/${channelId}/${xyneId}`;
  return params.length > 0 ? `${base}?${params.join('&')}` : base;
}

/**
 * Dashboard-relative URL for a citation (or an absolute one for
 * kind='external' / 'collection-item'). Null when the citation carries too
 * little to route — the chip is then dropped from the prose.
 */
export function buildClawCitationUrl(citation: BriefCitation): string | null {
  if (citation.kind === 'external' && citation.url) {
    return citation.url;
  }

  const isDesk = isDeskChannelType(citation.channelKind);
  if (
    (citation.kind === 'thread' || citation.kind === 'ticket') &&
    isDesk &&
    citation.channelId &&
    citation.xyneId
  ) {
    return buildSupportPath(
      citation.channelId,
      citation.xyneId,
      citation.conversationId,
      citation.ticketId,
      citation.mailId,
    );
  }

  if (citation.kind === 'thread' && citation.channelId) {
    if (citation.conversationId) {
      const base = `/chat/dir/${citation.channelId}/${citation.conversationId}#origin=${citation.conversationId}`;
      return citation.messageId ? `${base}&messageId=${citation.messageId}` : base;
    }
    return `/chat/dir/${citation.channelId}`;
  }

  const canvasKey =
    citation.kind === 'canvas' ? citation.viewAccessId || citation.canvasId : undefined;
  if (citation.kind === 'canvas' && canvasKey) {
    return `/chat/canvas/${canvasKey}`;
  }

  if (citation.kind === 'recording' && citation.recordingId) {
    return `/recordings/${citation.recordingId}`;
  }

  if (
    citation.kind === 'ticket' &&
    citation.ticketId &&
    citation.channelId &&
    citation.conversationId
  ) {
    return `/chat/dir/${citation.channelId}/${citation.conversationId}/${citation.ticketId}?selectedTab=thread`;
  }

  if (citation.kind === 'collection-item' && citation.url) {
    return citation.url;
  }

  return null;
}

export function getClawCitationLabel(citation: BriefCitation): string {
  if (citation.label) return citation.label;
  if (citation.kind === 'thread') {
    return citation.channelName ? `Thread in #${citation.channelName}` : 'Spaces thread';
  }
  if (citation.kind === 'canvas') return 'Canvas';
  if (citation.kind === 'recording') return 'Recording';
  if (citation.kind === 'ticket') return `Ticket ${citation.ticketId || ''}`.trim();
  if (citation.kind === 'external') return 'Source link';
  if (citation.kind === 'collection-item') return citation.fileName || 'Knowledge base file';
  return 'Reference';
}

/**
 * Brand-icon registry: `iconKey` → inline `data:` SVG URI. The payload ships
 * each unique icon once in `clawCitationIcons`; icon keys are stable global
 * constants whose bytes never change, so a module-level cache that accumulates
 * across briefs is safe.
 */
const clawIconRegistry = new Map<string, string>();

export function registerClawIcons(icons: Record<string, string> | undefined): void {
  if (!icons) return;
  for (const [key, url] of Object.entries(icons)) {
    if (key && typeof url === 'string' && url) clawIconRegistry.set(key, url);
  }
}

export function resolveCitationIconUrl(
  citation: BriefCitation | null | undefined,
): string | undefined {
  if (!citation) return undefined;
  if (citation.iconUrl) return citation.iconUrl;
  if (citation.iconKey) return clawIconRegistry.get(citation.iconKey);
  return undefined;
}

/** Citation brand icons arrive as `data:image/svg+xml,…` URIs; SvgXml needs
 *  the raw markup. Returns null for anything that isn't a decodable SVG URI. */
export function decodeSvgDataUri(uri: string | undefined): string | null {
  if (!uri) return null;
  const commaIdx = uri.indexOf(',');
  if (!uri.startsWith('data:image/svg+xml') || commaIdx === -1) return null;
  const payload = uri.slice(commaIdx + 1);
  try {
    if (uri.includes(';base64')) {
      // Hermes ships atob.
      return globalThis.atob(payload);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}
