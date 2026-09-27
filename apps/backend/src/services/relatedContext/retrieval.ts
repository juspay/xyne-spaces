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
 * One search per kind. A single list across schemas does not work: message scores
 * run higher than ticket and transcript scores, so chat hits push every other kind
 * off the end. Calls are found through their transcripts — a call without one has
 * nothing to relate a draft to, and the transcript result is what opens the call.
 */
const SEARCHES: Array<{
  kind: CandidateKind;
  apps: string[];
  filters: Record<string, unknown>;
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
  },
  {
    kind: 'call',
    apps: ['file'],
    filters: {
      file: { docType: [VespaDocType.FILE], subApp: [SubApp.TRANSCRIPT] },
      presentationSummary: 'default',
    },
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
 * out of search logs and analytics. A kind whose search fails is skipped.
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
  limit: number
): Promise<TransformedSearchResult[]> {
  const started = Date.now();
  let stage: 'vespa' | 'transform' = 'vespa';
  try {
    const response = await vespaService.searchService.searchVespa(
      draft,
      ctx.auth.userId,
      kind.apps,
      {
        offset: 0,
        limit,
        groupBy: '',
        slack: {},
        ticket: {},
        file: {},
        mail: {},
        call: {},
        workspaceId: ctx.auth.workspaceId,
        privateQuery: true,
        ...kind.filters,
      }
    );
    const vespaMs = Date.now() - started;
    const hits = (response.root.children ?? []) as VespaSearchHit[];
    stage = 'transform';
    const results = await transformVespaResults(hits, db, false, true);
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
    return [];
  }
}

/**
 * Collapses message hits into threads. Replies come back as separate hits, and one
 * well-matched thread can fill the page; the best-scoring hit stands for its thread
 * and is where a click lands.
 */
function toThreads(hits: TransformedSearchResult[], ctx: RetrievalContext) {
  const threads = new Map<string, TransformedSearchResult>();
  for (const hit of hits) {
    const conversationId = hit.searchContext?.conversationId;
    if (!conversationId || conversationId === ctx.conversationId) continue;
    if (!threads.has(conversationId)) threads.set(conversationId, hit);
  }
  return [...threads.entries()];
}

/**
 * Drops threads that are a ticket's own discussion when that ticket is already a
 * candidate — the ticket stands for both, and showing the pair reads as a duplicate.
 */
async function withoutTicketThreads(
  threads: Array<[string, TransformedSearchResult]>,
  ticketIds: Set<string>
): Promise<Array<[string, TransformedSearchResult]>> {
  if (threads.length === 0 || ticketIds.size === 0) return threads;
  try {
    const conversations = await db.conversation.findMany({
      where: { conversationId: { in: threads.map(([conversationId]) => conversationId) } },
      select: { conversationId: true, ticketId: true },
    });
    const ticketOf = new Map(conversations.map((c) => [c.conversationId, c.ticketId]));
    return threads.filter(([conversationId]) => {
      const ticketId = ticketOf.get(conversationId);
      return !ticketId || !ticketIds.has(ticketId);
    });
  } catch (error) {
    logger.error('[RelatedContext] ticket lookup failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return threads;
  }
}

/**
 * The thread as Jev should read it: the opening message and its first replies.
 * Whether a thread holds the answer or only the same question is decided by the
 * replies, which the matching hit alone does not show. Messages visible only to
 * someone else, and deleted ones, are left out.
 */
async function threadTexts(conversationIds: string[]): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  await Promise.all(
    conversationIds.map(async (conversationId) => {
      // The thread came from the person's own search; a reply meant for someone else
      // still stays out.
      const messages = await db.message.findMany({
        where: { conversationId, isDeleted: false, visibleTo: null },
        orderBy: { createdAt: 'asc' },
        take: THREAD_MESSAGES,
        select: { content: true },
      });
      const [opening, ...replies] = messages.map((m) => plain(m.content)).filter(Boolean);
      if (!opening) return;
      const lines = [
        `Opening message: ${opening}`,
        ...replies.map((r, i) => `Reply ${i + 1}: ${r}`),
      ];
      texts.set(conversationId, clip(lines.join('\n')));
    })
  );
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

/** Candidates for `draft`, best first within each kind. Never throws. */
export async function retrieveCandidates(
  draft: string,
  ctx: RetrievalContext,
  limits: RetrievalLimits
): Promise<Candidate[]> {
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
              kind.kind === 'thread' ? limits.messageHits : limits.perKind
            ),
          ] as const
      )
    )
  );
  const hitsOf = (kind: CandidateKind): TransformedSearchResult[] => found.get(kind) ?? [];

  const ticketIds = new Set(hitsOf('ticket').map((ticket) => ticket.id));
  const threads = (await withoutTicketThreads(toThreads(hitsOf('thread'), ctx), ticketIds)).slice(
    0,
    limits.perKind
  );
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
