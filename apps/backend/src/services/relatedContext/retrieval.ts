import { db } from '@/database/client';
import type { ACLContext } from '@/database/acl/base-acl';
import { logger } from '@/utils/logger';
import { stripHtml } from '@/agents/xyne-ai/tools/helpers';
import { vespaService } from '@/services/vespaSearch';
import {
  transformVespaResults,
  type TransformedSearchResult,
} from '@/services/vespaSearch/resultTransform';
import { SubApp, VespaDocType, type VespaSearchHit } from '@/vespa/src/types';

export type CandidateKind = 'thread' | 'ticket' | 'canvas' | 'call';

/** Something already in the workspace that the draft might be about. */
export interface Candidate {
  /** Stable across requests: `<kind>:<id>`. */
  id: string;
  kind: CandidateKind;
  /** The search result the client opens, exactly as cmd+K would. */
  result: TransformedSearchResult;
  /** Plain text Jev reads to decide how the candidate relates to the draft. */
  text: string;
}

export interface RetrievalContext {
  /** Who is typing. Searches run as them. */
  auth: ACLContext;
  /** The thread being replied in — never suggested back to itself. */
  conversationId?: string;
}

export interface RetrievalLimits {
  /** Message hits to fetch before collapsing them into threads. */
  messageHits: number;
  /** Candidates kept per kind. */
  perKind: number;
}

/** Enough of each candidate for Jev to judge it, not so much that a long thread dominates. */
const MAX_CANDIDATE_CHARS = 900;
/** Opening message plus the first replies — where an answer usually is. */
const THREAD_MESSAGES = 8;
/**
 * The search's transcript filter also matches chat and ticket attachments, so a file
 * search asks for this many times the page and keeps only its own sub-app.
 */
const FILE_PAGE_FACTOR = 3;
/**
 * The person's own messages from this long ago or less are left out: what they just
 * posted is not related context for what they write next.
 */
const OWN_RECENT_MS = 30 * 60 * 1000;

/**
 * One search per kind. A single list across schemas does not work: message scores
 * run higher than ticket and transcript scores, so chat hits push every other kind
 * off the end. Calls are found through their transcripts — a call without one has
 * nothing to relate a draft to, and the transcript result is what opens the call.
 */
const SEARCHES: Array<{
  kind: CandidateKind;
  apps: string[];
  filters: Record<string, unknown>;
  /** The file sub-app a hit must be; see FILE_PAGE_FACTOR. */
  subApp?: SubApp;
}> = [
  {
    kind: 'thread',
    apps: ['chat'],
    filters: { slack: { excludeBotMessages: true, docType: [VespaDocType.MESSAGE] } },
  },
  { kind: 'ticket', apps: ['ticket'], filters: { ticket: { docType: [VespaDocType.TICKET] } } },
  // Files use the `default` summary: `lean` leaves out the chunks, and without the
  // matched chunk a canvas or a call reaches Jev as a bare title.
  {
    kind: 'canvas',
    apps: ['file'],
    filters: {
      file: { docType: [VespaDocType.FILE], subApp: [SubApp.CANVAS] },
      presentationSummary: 'default',
    },
    subApp: SubApp.CANVAS,
  },
  {
    kind: 'call',
    apps: ['file'],
    filters: {
      file: { docType: [VespaDocType.FILE], subApp: [SubApp.TRANSCRIPT] },
      presentationSummary: 'default',
    },
    subApp: SubApp.TRANSCRIPT,
  },
];

const plain = (value: string | undefined): string =>
  stripHtml((value ?? '').replace(/<\/?hi>/gi, ''));

const clip = (value: string): string =>
  value.length > MAX_CANDIDATE_CHARS ? `${value.slice(0, MAX_CANDIDATE_CHARS)}…` : value;

/** An error for the logs, with the draft taken out of its message wherever it appears. */
function describeError(error: unknown, draft: string): { name: string; message: string } {
  if (!(error instanceof Error)) return { name: 'unknown', message: '' };
  const message = draft ? error.message.split(draft).join('[draft]') : error.message;
  return { name: error.name, message: message.slice(0, 300) };
}

/**
 * Searches as the person typing — the same permission-gated query cmd+K runs, and
 * like cmd+K it trusts that filter's answer. The draft is marked private so it stays
 * out of search logs and analytics, and searched as plain text: a draft's "today" is
 * a word in a sentence, not a time filter. Null when the search fails or `signal`
 * says the caller has gone — the search in flight still finishes, but nothing after it
 * runs.
 *
 * TODO: re-check results against the app's own read rules, here and in cmd+K
 * together. The search's permission fields are copies and differ from those rules:
 * - a call transcript matches for everyone in the call's channel, while a recording
 *   opens only for the people it is shared with;
 * - public-channel messages match for guests, who see only the channels granted to them;
 * - the copies trail changes, so someone removed from a private channel, or a deleted
 *   ticket, still matches until the index catches up.
 */
async function search(
  draft: string,
  ctx: RetrievalContext,
  kind: (typeof SEARCHES)[number],
  limit: number,
  signal: AbortSignal | undefined
): Promise<TransformedSearchResult[] | null> {
  const started = Date.now();
  let stage: 'vespa' | 'transform' = 'vespa';
  try {
    const response = await vespaService.searchService.searchVespa(
      draft,
      ctx.auth.userId,
      kind.apps,
      {
        offset: 0,
        limit: kind.subApp ? limit * FILE_PAGE_FACTOR : limit,
        groupBy: '',
        slack: {},
        ticket: {},
        file: {},
        mail: {},
        call: {},
        workspaceId: ctx.auth.workspaceId,
        privateQuery: true,
        literalQuery: true,
        ...kind.filters,
      }
    );
    const vespaMs = Date.now() - started;
    if (signal?.aborted) return null;
    const hits = ((response.root.children ?? []) as VespaSearchHit[])
      .filter(
        (hit) => !kind.subApp || ('subApp' in hit.fields && hit.fields.subApp === kind.subApp)
      )
      .slice(0, limit);
    stage = 'transform';
    const results = await transformVespaResults(hits, db);
    logger.info('[RelatedContext] vespa search', {
      kind: kind.kind,
      vespaMs,
      totalMs: Date.now() - started,
      hits: hits.length,
    });
    return results;
  } catch (error) {
    logger.error('[RelatedContext] vespa search failed', {
      kind: kind.kind,
      stage,
      ms: Date.now() - started,
      error: describeError(error, draft),
    });
    return null;
  }
}

/**
 * Collapses message hits into threads. Replies come back as separate hits, and one
 * well-matched thread can fill the page; the best-scoring hit stands for its thread
 * and is where a click lands.
 */
function toThreads(hits: TransformedSearchResult[]) {
  const threads = new Map<string, TransformedSearchResult>();
  for (const hit of hits) {
    const conversationId = hit.searchContext?.conversationId;
    if (!conversationId) continue;
    if (!threads.has(conversationId)) threads.set(conversationId, hit);
  }
  return [...threads.entries()];
}

/**
 * Drops threads that are a ticket's own discussion when that ticket is already a
 * candidate — the ticket stands for both, and showing the pair reads as a duplicate.
 * A ticket hit carries its discussion's id, so no lookup is needed.
 */
function withoutTicketThreads(
  threads: Array<[string, TransformedSearchResult]>,
  tickets: TransformedSearchResult[]
): Array<[string, TransformedSearchResult]> {
  const ticketThreads = new Set(
    tickets.flatMap((ticket) => ticket.searchContext?.conversationId ?? [])
  );
  return threads.filter(([conversationId]) => !ticketThreads.has(conversationId));
}

/**
 * The thread as Jev should read it: the opening message and its first replies.
 * Whether a thread holds the answer or only the same question is decided by the
 * replies, which the matching hit alone does not show. Messages visible only to
 * someone else, and deleted ones, are left out.
 */
async function threadTexts(conversationIds: string[]): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  if (conversationIds.length === 0) return texts;
  // One query for every thread, earliest first, then each thread's first messages. The
  // cap bounds a long thread; one that misses out falls back to its search snippet.
  // The thread came from the person's own search; a reply meant for someone else
  // still stays out.
  const messages = await db.message.findMany({
    where: { conversationId: { in: conversationIds }, isDeleted: false, visibleTo: null },
    orderBy: { createdAt: 'asc' },
    take: conversationIds.length * THREAD_MESSAGES * 4,
    select: { conversationId: true, content: true },
  });
  const byThread = new Map<string, string[]>();
  for (const message of messages) {
    const lines = byThread.get(message.conversationId) ?? [];
    const text = plain(message.content);
    if (text && lines.length < THREAD_MESSAGES) lines.push(text);
    byThread.set(message.conversationId, lines);
  }
  for (const [conversationId, [opening, ...replies]] of byThread) {
    if (!opening) continue;
    const lines = [`Opening message: ${opening}`, ...replies.map((r, i) => `Reply ${i + 1}: ${r}`)];
    texts.set(conversationId, clip(lines.join('\n')));
  }
  return texts;
}

function describe(kind: CandidateKind, result: TransformedSearchResult): string {
  switch (kind) {
    case 'ticket': {
      const status = result.searchContext?.stageName ?? result.searchContext?.ticketStatus;
      return clip(
        [`Ticket: ${plain(result.title)}`, status && `Status: ${status}`, plain(result.context)]
          .filter(Boolean)
          .join('\n')
      );
    }
    case 'canvas':
      return clip(`Document: ${plain(result.title)}\n${plain(result.context)}`);
    case 'call':
      return clip(
        [`Call: ${plain(result.title)}`, plain(result.subtitle), plain(result.context)]
          .filter(Boolean)
          .join('\n')
      );
    default:
      return clip(plain(result.context));
  }
}

/**
 * Candidates for `draft`, best first within each kind; null when every search failed.
 * The thread being replied in is never among them, nor the ticket or call it belongs
 * to. Once `signal` says the caller has gone, the rest is skipped. Never throws.
 */
export async function retrieveCandidates(
  draft: string,
  ctx: RetrievalContext,
  limits: RetrievalLimits,
  signal?: AbortSignal
): Promise<Candidate[] | null> {
  const found = new Map(
    await Promise.all(
      SEARCHES.map(
        async (kind) =>
          [
            kind.kind,
            await search(
              draft,
              ctx,
              kind,
              kind.kind === 'thread' ? limits.messageHits : limits.perKind,
              signal
            ),
          ] as const
      )
    )
  );
  // Every search failing is a failed lookup, not an empty one; one failing just leaves
  // its kind out.
  if ([...found.values()].every((results) => results === null)) return null;
  if (signal?.aborted) return [];
  // The item being replied in is not related context to itself.
  const hitsOf = (kind: CandidateKind): TransformedSearchResult[] =>
    (found.get(kind) ?? []).filter(
      (result) => !ctx.conversationId || result.searchContext?.conversationId !== ctx.conversationId
    );
  // Nor what the person posted moments ago.
  const recentlyOwn = (hit: TransformedSearchResult): boolean =>
    hit.searchContext?.senderId === ctx.auth.userId &&
    Date.now() - (hit.searchContext?.createdAtTimestamp ?? 0) < OWN_RECENT_MS;
  const threads = withoutTicketThreads(
    toThreads(hitsOf('thread').filter((hit) => !recentlyOwn(hit))),
    hitsOf('ticket')
  ).slice(0, limits.perKind);
  let texts = new Map<string, string>();
  try {
    texts = await threadTexts(threads.map(([conversationId]) => conversationId));
  } catch (error) {
    logger.error('[RelatedContext] thread fetch failed', { error: describeError(error, draft) });
  }

  const candidates: Candidate[] = threads.map(([conversationId, result]) => ({
    id: `thread:${conversationId}`,
    kind: 'thread',
    result,
    text: texts.get(conversationId) ?? describe('thread', result),
  }));

  for (const kind of ['ticket', 'canvas', 'call'] as const) {
    for (const result of hitsOf(kind)) {
      candidates.push({
        id: `${kind}:${result.id}`,
        kind,
        result,
        text: describe(kind, result),
      });
    }
  }
  return candidates;
}
