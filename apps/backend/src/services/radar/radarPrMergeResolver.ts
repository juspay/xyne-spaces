import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { extractUserMentions } from '@/utils/mentionParser';
import {
  radarParser,
  type ParserPrMerged,
  type ParserWindowMessage,
} from '@/services/radar/radarParser';
import { radarApplier, type ApplyOperation } from '@/services/radar/radarApplier';
import { dmChannelIdFromScopeKey, radarScopeFor, type RadarScope } from '@/services/radar/radarScope';
import { namesAnotherPr, normalisePrUrl } from '@/services/radar/radarPrLinks';
import { stripHtml } from '@/services/radar/radarExecutionService';

const prisma = DatabaseClient.getInstance();
const TAG = '[RADAR-PR-MERGE]';

/** Items handed to the model per thread — the same budget a window parse gets. */
const MAX_CANDIDATES = config.radar.maxOpenItems;
/** Threads judged per merge, newest link first. Each one is an LLM call. */
const MAX_SCOPES = 20;
/** Link messages shown to the model per thread, newest first. */
const MAX_LINK_CONTEXT = 5;
/** Recorded links read per merge, newest first; bounds the messageId list. */
const MAX_LINKS = 500;
/**
 * How long a merge waits before looking up its links. The worker records a
 * link only after its debounce, so "merging <link>" posted just before the
 * merge would otherwise not be there yet. The pass runs after the webhook has
 * answered, so the wait costs GitHub nothing.
 */
const LINK_SETTLE_MS = Math.max(config.radar.debounceMs, config.radar.dmDebounceMs) + 30_000;
/** How far from a link an item counts as "about it" when the thread is over budget. */
const LINK_NEIGHBOURHOOD_MS = 24 * 60 * 60 * 1000;
/** Id of the synthetic merge message the model cites. Never stored. */
const MERGE_MESSAGE_ID = 'pr-merge';
/**
 * Waits before each parser retry. GitHub sends a merge once, and this pass is
 * the only route by which a merge closes anything, so a gateway blip with no
 * retry would leave the item open for good.
 */
const PARSE_RETRY_DELAYS_MS = [5_000, 30_000];

export interface PrMergedEvent {
  workspaceId: string;
  /** Which webhook reported the merge; named as the merge message's author. */
  provider: 'GitHub' | 'Bitbucket';
  /** The PR's web URL as the provider reports it; canonicalised before use. */
  prUrl: string;
  /**
   * The URL this provider's webhook stored on the PR's pull_requests rows, when
   * it differs from prUrl. Bitbucket rebuilds it by string replace, and a self
   * link ending in "/overview" comes out as ".../overview/pull-requests/<n>".
   */
  storedPrUrl?: string;
  prNumber: number;
  prTitle: string;
  /** owner/repo (GitHub) or PROJECT/repo (Bitbucket) */
  repoFullName: string;
  baseBranch: string;
  mergedBy: string;
  mergedAt: Date;
}

/** A message that carries the PR link. */
interface LinkMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: Date;
}

/** A thread to judge, and the link messages that tie it to the PR (none for a ticket thread). */
interface ScopeTarget {
  scope: RadarScope;
  links: LinkMessage[];
}

/** What one thread's pass did, as written to its run log. */
interface RunState {
  parserRan: boolean;
  proposedOps?: unknown;
  validOps?: unknown;
  droppedOps?: unknown;
  applied?: unknown;
  assessment?: string;
  error?: string;
}

interface Candidate {
  id: string;
  conversationId: string;
  title: string;
  contextSummary: string | null;
  requestedBy: string[];
  pendingOn: string[];
  sourceMessageId: string;
}

/**
 * PR-merge-driven resolution.
 *
 * A merge is announced by a SYSTEM message, and Radar never reads SYSTEM
 * messages, so this pass is the only route by which a merge closes an open
 * "review/merge PR 42" item. It works the way the reaction resolver does: SQL
 * narrows the ledger to threads tied to the PR, and the parser — same resolve
 * rule, its own pass section — decides which items the merge actually delivers.
 *
 * Nothing is resolved on a URL match alone: "deploy <PR link> to prod" carries
 * the link too, and a merge settles neither that nor most asks that cite a PR.
 *
 * Each thread is parsed, applied and logged on its own. A thread's debug trail
 * is readable by anyone who can open that thread, so a shared pass would leak
 * one thread's items into another's drawer — a private channel's into a
 * public one's.
 */
class RadarPrMergeResolver {
  async onPrMerged(event: PrMergedEvent): Promise<void> {
    if (!config.radar.enabled) return;

    logger.info(`${TAG} PR merged, judging its threads once links settle`, {
      prUrl: event.prUrl,
      inMs: LINK_SETTLE_MS,
    });
    await new Promise(resolve => setTimeout(resolve, LINK_SETTLE_MS));

    let targets: ScopeTarget[];
    try {
      targets = await this.scopesFor(event);
    } catch (error) {
      logger.warn(`${TAG} finding threads for the PR failed`, {
        prUrl: event.prUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    // resolveScope never throws, so one thread's failure cannot cost the rest
    // their resolve — GitHub does not send the merge again.
    for (const target of targets) {
      await this.resolveScope(event, target);
    }
  }

  /** One thread: find its open items, ask the parser, apply, log. Never throws. */
  private async resolveScope(event: PrMergedEvent, { scope, links }: ScopeTarget): Promise<void> {
    const startedAt = Date.now();
    let candidates: Candidate[] = [];
    let notOffered: string[] = [];
    const run: RunState = { parserRan: false };

    try {
      // An item that names a different PR is never this merge's to settle, even
      // when it was asked in the same message as this PR's link ("review 9201,
      // and my vespa PR 323"). Kept from the model, not left to its judgement.
      const prUrl = normalisePrUrl(event.prUrl);
      const open = await this.candidatesFor(event, scope, links);
      candidates = open.filter(c => !namesAnotherPr(c.title, c.contextSummary, prUrl, event.prNumber));
      notOffered = open.filter(c => !candidates.includes(c)).map(c => c.id);
      if (candidates.length === 0) {
        if (notOffered.length > 0) {
          run.assessment = `Every open item here names a different PR (${notOffered.length}); nothing offered.`;
        }
        // A ticket thread with nothing open: nothing to judge, nothing worth a row.
        return;
      }

      const sourceMessages = await prisma.message.findMany({
        where: {
          messageId: { in: candidates.map(c => c.sourceMessageId) },
          isDeleted: false,
          visibleTo: null,
        },
        select: { messageId: true, senderId: true, content: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      // The model sees each item's ask AND the message that tied this thread
      // to the PR — "review this" alone does not say which PR it meant.
      const seen = new Set<string>();
      const contextMessages = [...sourceMessages, ...links.slice(0, MAX_LINK_CONTEXT)]
        .filter(m => !seen.has(m.messageId) && seen.add(m.messageId))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      const nameById = await this.namesFor([
        ...candidates.flatMap(c => [...c.requestedBy, ...c.pendingOn]),
        ...contextMessages.map(m => m.senderId),
      ]);

      const pr: ParserPrMerged = {
        url: event.prUrl,
        number: event.prNumber,
        title: event.prTitle,
        repo: event.repoFullName,
        merged_by: event.mergedBy,
        base_branch: event.baseBranch,
      };
      const mergeMessage: ParserWindowMessage = {
        id: MERGE_MESSAGE_ID,
        author: { id: event.provider.toLowerCase(), name: event.provider },
        text:
          `Pull request #${event.prNumber} "${event.prTitle}" in ${event.repoFullName} ` +
          `was merged into ${event.baseBranch} by ${event.mergedBy}. ${event.prUrl}`,
        mentions: [],
        timestamp_iso: event.mergedAt.toISOString(),
      };

      run.parserRan = true;
      const transitions = await this.withRetry(event, scope, () =>
        radarParser.parseWindow(
          candidates.map(c => ({
            id: c.id,
            title: c.title,
            context: c.contextSummary,
            requested_by: c.requestedBy,
            pending_on: c.pendingOn,
            source_message_id: c.sourceMessageId,
          })),
          [mergeMessage],
          Object.fromEntries(nameById),
          contextMessages.map(m => ({
            id: m.messageId,
            author: { id: m.senderId, name: nameById.get(m.senderId) ?? m.senderId },
            text: stripHtml(m.content),
            mentions: extractUserMentions(m.content).map(id => ({ id, name: nameById.get(id) ?? id })),
            timestamp_iso: m.createdAt.toISOString(),
          })),
          { pr_merged: pr },
        ),
      );

      run.proposedOps = transitions.operations;
      run.assessment = transitions.assessment;

      // Same closed-list check as the reaction pass: only resolves, only on
      // items this pass offered.
      const byId = new Map(candidates.map(c => [c.id, c]));
      const valid = transitions.operations.filter(
        op => op.op === 'resolve' && op.itemId && byId.has(op.itemId),
      );
      const dropped = transitions.operations.filter(op => !valid.includes(op));
      if (dropped.length > 0) run.droppedOps = dropped;
      if (valid.length === 0) return;

      const operations: ApplyOperation[] = valid.map(op => ({
        ...op,
        // The merge message was never stored; the audit row records null.
        sourceMessageId: '',
        conversationId: (byId.get(op.itemId as string) as Candidate).conversationId,
        reason: `PR merged: ${event.prUrl}${op.reason ? ` — ${op.reason}` : ''}`,
      }));
      run.validOps = operations;

      run.applied = await radarApplier.apply({
        workspaceId: event.workspaceId,
        conversationId: scope.conversationId,
        scope,
        operations,
        // No watermark: a merge consumes no window, and advancing it would
        // swallow messages nobody has parsed yet.
        actorType: 'pr_merge',
      });

      logger.info(`${TAG} resolved by PR merge`, {
        prUrl: event.prUrl,
        scope: scope.key,
        itemIds: operations.map(o => o.itemId),
      });
    } catch (error) {
      // Never allowed to fail the webhook, nor the threads after this one.
      run.error = error instanceof Error ? error.message : String(error);
      logger.warn(`${TAG} PR merge pass failed`, { prUrl: event.prUrl, scope: scope.key, error: run.error });
    } finally {
      // Keyed by scope like every other pass, so "why did this close" (and
      // "why didn't it") is answerable from this thread's debug drawer.
      if (candidates.length > 0 || notOffered.length > 0 || run.error) {
        await this.writeRunLog(event, scope, run, startedAt);
      }
    }
  }

  private async writeRunLog(
    event: PrMergedEvent,
    scope: RadarScope,
    run: RunState,
    startedAt: number,
  ): Promise<void> {
    await prisma.executionRunLog
      .create({
        data: {
          workspaceId: event.workspaceId,
          conversationId: scope.key,
          gatePassed: true,
          gateReason: 'pr-merge',
          windowSize: 1,
          parserRan: run.parserRan,
          proposedOps: run.proposedOps as object | undefined,
          validOps: run.validOps as object | undefined,
          droppedOps: run.droppedOps as object | undefined,
          applied: run.applied as object | undefined,
          assessment: run.assessment,
          error: run.error,
          durationMs: Date.now() - startedAt,
        },
      })
      .catch(error => logger.warn(`${TAG} run log write failed`, { error }));
  }

  /**
   * Open items worth offering. Normally the thread's newest, like a window
   * parse. A thread over budget would drop older asks — "review my PR" from
   * three weeks ago under thirty newer DM items — so then the items raised
   * where the link was posted, or within a day of it, go first.
   */
  private async candidatesFor(
    event: PrMergedEvent,
    scope: RadarScope,
    links: LinkMessage[],
  ): Promise<Candidate[]> {
    const select = {
      id: true,
      conversationId: true,
      title: true,
      contextSummary: true,
      requestedBy: true,
      pendingOn: true,
      sourceMessageId: true,
    } as const;
    const inScope = {
      workspaceId: event.workspaceId,
      ...(scope.isDmChannel ? { channelId: scope.channelId } : { conversationId: scope.conversationId }),
      status: 'OPEN',
    };
    const newest = await prisma.executionItem.findMany({
      where: inScope,
      orderBy: { updatedAt: 'desc' },
      take: MAX_CANDIDATES,
      select,
    });
    if (newest.length < MAX_CANDIDATES || links.length === 0) return newest;

    const times = links.map(l => l.createdAt.getTime());
    const near = await prisma.executionItem.findMany({
      where: {
        ...inScope,
        OR: [
          // In a DM the ask and the link are usually sibling conversations; in
          // a thread the link's conversation is the scope itself, so only the
          // time window narrows anything there.
          ...(scope.isDmChannel
            ? [{ conversationId: { in: [...new Set(links.map(l => l.conversationId))] } }]
            : []),
          {
            createdAt: {
              gte: new Date(Math.min(...times) - LINK_NEIGHBOURHOOD_MS),
              lte: new Date(Math.max(...times) + LINK_NEIGHBOURHOOD_MS),
            },
          },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_CANDIDATES,
      select,
    });
    const byId = new Map(near.map(i => [i.id, i]));
    for (const item of newest) {
      if (byId.size >= MAX_CANDIDATES) break;
      byId.set(item.id, item);
    }
    return [...byId.values()];
  }

  /**
   * Threads the merge could plausibly settle something in:
   *  1. the thread of the ticket the PR was raised for, and
   *  2. every thread or DM the PR link was posted in, as the Radar worker
   *     recorded it — one indexed lookup, nothing searched at merge time.
   *
   * An item's own age is not a filter: "fix the login bug and get it merged"
   * is asked before the PR exists, and the link lands in the thread later.
   */
  private async scopesFor(event: PrMergedEvent): Promise<ScopeTarget[]> {
    const targets = new Map<string, ScopeTarget>();
    for (const scope of await this.ticketScopesFor(event)) {
      targets.set(scope.key, { scope, links: [] });
    }

    const prUrl = normalisePrUrl(event.prUrl);
    if (!prUrl) return [...targets.values()];
    let recorded: { messageId: string; scopeKey: string; channelId: string; conversationId: string }[];
    let messages: LinkMessage[];
    try {
      recorded = await prisma.radarPrLink.findMany({
        where: { workspaceId: event.workspaceId, prUrl },
        orderBy: { postedAt: 'desc' },
        take: MAX_LINKS,
        select: { messageId: true, scopeKey: true, channelId: true, conversationId: true },
      });
      // Re-read the messages: one deleted or made private since it was
      // recorded no longer ties its thread to the PR.
      messages =
        recorded.length === 0
          ? []
          : await prisma.message.findMany({
              where: { messageId: { in: recorded.map(r => r.messageId) }, isDeleted: false, visibleTo: null },
              select: { messageId: true, conversationId: true, senderId: true, content: true, createdAt: true },
            });
    } catch (error) {
      // The ticket threads found above are still worth judging.
      logger.warn(`${TAG} reading PR links failed`, {
        prUrl: event.prUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return [...targets.values()];
    }
    const byId = new Map(messages.map(m => [m.messageId, m]));
    const links = recorded
      .filter(r => byId.has(r.messageId))
      .map(r => ({ ...r, message: byId.get(r.messageId) as LinkMessage }))
      // Newest link first: if a PR was pasted into more threads than we judge,
      // the ones it was most recently discussed in win.
      .sort((a, b) => b.message.createdAt.getTime() - a.message.createdAt.getTime());

    let skipped = 0;
    for (const link of links) {
      const existing = targets.get(link.scopeKey);
      if (existing) {
        existing.links.push(link.message);
        continue;
      }
      if (targets.size >= MAX_SCOPES) {
        skipped++;
        continue;
      }
      const scope: RadarScope = {
        key: link.scopeKey,
        channelId: link.channelId,
        conversationId: link.conversationId,
        isDmChannel: dmChannelIdFromScopeKey(link.scopeKey) !== null,
      };
      targets.set(scope.key, { scope, links: [link.message] });
    }
    if (skipped > 0) {
      logger.warn(`${TAG} PR linked in more threads than judged`, {
        prUrl: event.prUrl,
        judged: targets.size,
        skipped,
      });
    }

    return [...targets.values()];
  }

  /** The ticket threads for a PR, via each row's own ticketId or its workflow's. */
  private async ticketScopesFor(event: PrMergedEvent): Promise<RadarScope[]> {
    // prUrl is not unique: a PR can have a dev row and a workflow row.
    const rows = await prisma.pullRequests.findMany({
      where: { workspaceId: event.workspaceId, prUrl: { in: [...new Set([event.prUrl, event.storedPrUrl ?? event.prUrl])] } },
      select: { ticketId: true, workflowExecution: { select: { workflow: { select: { ticketId: true } } } } },
    });
    const ticketIds = [
      ...new Set(
        rows
          .map(r => r.ticketId ?? r.workflowExecution?.workflow?.ticketId ?? null)
          .filter((id): id is string => !!id),
      ),
    ];
    if (ticketIds.length === 0) return [];
    const tickets = await prisma.ticket.findMany({
      where: { id: { in: ticketIds } },
      select: { conversationId: true, channelId: true, channel: { select: { scopeType: true } } },
    });
    return tickets.map(t => radarScopeFor(t.channel?.scopeType ?? null, t.channelId, t.conversationId));
  }

  private async withRetry<T>(event: PrMergedEvent, scope: RadarScope, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt >= PARSE_RETRY_DELAYS_MS.length) throw error;
        logger.warn(`${TAG} parser call failed, retrying`, {
          prUrl: event.prUrl,
          scope: scope.key,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise(resolve => setTimeout(resolve, PARSE_RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  private async namesFor(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map(u => [u.id, u.name]));
  }
}

export const radarPrMergeResolver = new RadarPrMergeResolver();
