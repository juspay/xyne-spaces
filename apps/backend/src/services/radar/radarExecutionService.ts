import type { Prisma } from '@prisma/client';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { extractUserMentions } from '@/utils/mentionParser';
import { AttachmentEntityType } from '@xyne/shared';
import {
  radarParser,
  type ParserOpenItem,
  type ParserWindowMessage,
} from '@/services/radar/radarParser';
import { noOpReassignFeedback, validateTransitions } from '@/services/radar/radarValidator';
import { radarApplier } from '@/services/radar/radarApplier';
import type { RadarScope } from '@/services/radar/radarScope';

const prisma = DatabaseClient.getInstance();

// Cap per drain iteration so one job never loads an unbounded window; the
// drain loop below picks up whatever a full window clipped.
const MAX_WINDOW_MESSAGES = config.radar.maxWindowMessages;

// Already-processed messages below the watermark that ride along with each
// parse as read-only context — the model sees what the thread was about, but
// the validator rejects any operation citing them.
const CONTEXT_MESSAGES = config.radar.contextMessages;

const MAX_OPEN_ITEMS = config.radar.maxOpenItems;

/**
 * Consecutive parser failures on one window before the drain gives up on it and
 * advances past it. Without this, a window the parser deterministically cannot
 * handle is re-parsed by every subsequent message in the thread, indefinitely.
 */
const MAX_CONSECUTIVE_FAILURES = config.radar.maxConsecutiveFailures;

/** Users.status — deactivated accounts must never be assigned an item. */
const ACTIVE_USER_STATUS = 'ACTIVE';

// First contact with a thread has no watermark row. Rather than parsing the
// thread's entire history, bootstrap the watermark at now - lookback: the job
// was triggered by a fresh message, so the fresh burst is what matters.
const BOOTSTRAP_LOOKBACK_MS = config.radar.bootstrapLookbackMinutes * 60 * 1000;

/**
 * Radar execution engine — one call per drained job, one thread at a time.
 *
 * Drain loop: read everything above the thread's watermark, gate it, advance
 * the watermark, repeat until the window is empty. Looping until empty is what
 * closes Bull's active-window gap — an add during processing is deduped away,
 * but its messages sit above the watermark, so the loop still sees them.
 *
 * Watermark ordering is the composite (createdAt, messageId): messageId is a
 * cuid, not monotonic, so it only breaks ties within one timestamp.
 *
 * Every pass is recorded in execution_run_logs, which is where "what did it
 * decide, and why" is answered.
 */
interface RunLogDraft {
  workspaceId: string;
  conversationId: string;
  gatePassed: boolean;
  gateReason: string;
  windowSize: number;
  parserRan: boolean;
  proposedOps?: unknown;
  validOps?: unknown;
  droppedOps?: unknown;
  applied?: unknown;
  assessment?: string;
  error?: string;
}

/** An open item plus the conversation it was raised in. conversationId never
 *  reaches the model — it is swapped for the window's thread label first. */
type OpenItemRow = ParserOpenItem & { conversationId: string };

/**
 * Short thread labels for one parse. The parser is handed a flat transcript
 * ordered by time, and in a DM that transcript spans every conversation in the
 * channel — so a reply and the message before it are often unrelated. Labelling
 * each conversation restores the grouping the flattening destroyed.
 *
 * A conversation with a single message in view and no open item stays unlabelled:
 * that message was posted into the main flow rather than into any thread, and
 * saying so is more useful than inventing a thread of one.
 */
const buildThreadLabels = (
  ordered: Array<{ conversationId: string }>,
  itemConversationIds: Set<string>,
  isDmChannel: boolean,
): Map<string, string> => {
  // Only a flattened window needs labels. A thread-scoped window IS one
  // conversation, so leaving a message unlabelled there would assert it was
  // "posted into the main flow" — which the prompt takes literally, and which
  // is false for every reply in a thread.
  if (!isDmChannel) return new Map();
  const counts = new Map<string, number>();
  for (const m of ordered) counts.set(m.conversationId, (counts.get(m.conversationId) ?? 0) + 1);

  const labels = new Map<string, string>();
  for (const m of ordered) {
    if (labels.has(m.conversationId)) continue;
    const threaded = (counts.get(m.conversationId) ?? 0) > 1 || itemConversationIds.has(m.conversationId);
    if (threaded) labels.set(m.conversationId, `T${labels.size + 1}`);
  }
  return labels;
};

class RadarExecutionService {
  async processThread(scope: RadarScope): Promise<void> {
    const { conversationId } = scope;
    // A DM's window spans the channel's conversations; a thread's is itself.
    const messageScope = scope.isDmChannel
      ? { conversation: { channelId: scope.channelId } }
      : { conversationId };

    for (;;) {
      const state = await prisma.executionThreadState.findUnique({
        where: { conversationId: scope.key },
      });

      const floor = state
        ? { createdAt: state.watermarkCreatedAt, messageId: state.watermarkMsgId }
        : { createdAt: new Date(Date.now() - BOOTSTRAP_LOOKBACK_MS), messageId: '' };

      const window = await prisma.message.findMany({
        where: {
          ...messageScope,
          isDeleted: false,
          msgType: { not: 'SYSTEM' },
          // Private-visibility messages never enter Radar: items cite thread
          // content, and a restricted message must not leak through a card.
          visibleTo: null,
          OR: [
            { createdAt: { gt: floor.createdAt } },
            { createdAt: floor.createdAt, messageId: { gt: floor.messageId } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { messageId: 'asc' }],
        take: MAX_WINDOW_MESSAGES,
        select: {
          messageId: true,
          senderId: true,
          content: true,
          createdAt: true,
          workspaceId: true,
          // Needed per message, not per window: a DM window spans several
          // conversations and each item must be stamped with its own.
          conversationId: true,
          // Which message opened the thread, so a reply can be told from a root.
          conversation: { select: { initialMessageId: true } },
          sender: { select: { name: true } },
        },
      });

      if (window.length === 0) {
        return; // drained — the job may complete
      }

      // Gate: three deterministic branches — a tracked scope (any reply may move
      // a ball), an untracked one with a resolved @mention, or a two-person DM.
      // No heuristics; the only probabilistic judgment belongs to the parser.
      const openItems = await this.loadOpenItems(scope, [
        ...new Set(window.map(m => m.conversationId)),
      ]);
      const tracked = openItems.length > 0;

      // Per-message mentions feed both the gate and the parser's closed
      // assignment sources (pendingOn may only come from these + self-claim).
      const mentionsByMessage = new Map(
        window.map(m => [m.messageId, extractUserMentions(m.content)]),
      );
      const mentionedUserIds = [...new Set([...mentionsByMessage.values()].flat())];

      // In a 1:1 DM every message is addressed to the other person, so the
      // counterpart is an implicit mention. Without this a DM can never
      // bootstrap: tracked needs an item to already exist and nobody @mentions
      // in a two-person thread, so the first ask in any DM was invisible.
      //
      // Exactly two, not "at least two": a self-DM has nobody to hand a ball to,
      // and a DM-scoped channel with three participants — which this workspace
      // has — would make "the counterpart" two people at once.
      const dmParticipants = scope.isDmChannel
        ? await this.dmParticipants(scope.channelId)
        : [];
      const isOneToOneDm = dmParticipants.length === 2;
      const gatePassed = tracked || mentionedUserIds.length > 0 || isOneToOneDm;

      // Debug trail for the Radar debug panel: one row per drain pass,
      // written best-effort — observability must never break the pipeline.
      const startedAt = Date.now();
      const run: RunLogDraft = {
        workspaceId: window[0].workspaceId,
        // Keyed by scope, so a DM's passes stay together instead of scattering
        // across the sibling conversations its messages happen to start.
        conversationId: scope.key,
        gatePassed,
        gateReason: gatePassed
          ? tracked
            ? 'tracked-thread'
            : mentionedUserIds.length > 0
              ? 'new-mention'
              : 'dm-counterpart'
          : 'skip',
        windowSize: window.length,
        parserRan: false,
      };

      if (gatePassed) {
        logger.info('[RADAR-EXECUTION] Gate PASS', {
          conversationId,
          windowSize: window.length,
          reason: tracked ? 'tracked-thread' : 'new-mention',
          openItemCount: openItems.length,
          mentionedUserIds,
          bootstrap: !state,
        });
        // Valid operations + audit + watermark commit in ONE transaction, and a
        // failure propagates: Bull retries, the watermark stays put, and the
        // whole window is replayed.
        try {
          run.parserRan = true;
          // Already-consumed messages just below the watermark, sent as
          // read-only context so the model understands mid-thread windows.
          const context = await this.loadContextMessages(messageScope, floor);
          const contextMentions = new Map(
            context.map(m => [m.messageId, extractUserMentions(m.content)]),
          );
          // id -> name for everyone involved so far, so the model can match
          // a name typed in prose to an id (history-based assignment).
          const involvedIds = [
            ...new Set([
              ...openItems.flatMap(i => [...i.requested_by, ...i.pending_on]),
              ...[...mentionsByMessage.values()].flat(),
              ...[...contextMentions.values()].flat(),
            ]),
          ];
          // ONE name lookup per window, shared by known_users and by both
          // toParserMessages calls below — these used to be three overlapping
          // queries against the same table.
          const nameById = new Map<string, string>([
            ...window.map(m => [m.senderId, m.sender?.name ?? 'Unknown'] as const),
            ...context.map(m => [m.senderId, m.sender?.name ?? 'Unknown'] as const),
          ]);
          const unresolvedIds = involvedIds.filter(id => !nameById.has(id));
          if (unresolvedIds.length > 0) {
            const involvedUsers = await prisma.user.findMany({
              where: { id: { in: unresolvedIds } },
              select: { id: true, name: true },
            });
            for (const u of involvedUsers) nameById.set(u.id, u.name);
          }
          const knownUsers = Object.fromEntries(nameById);
          // One lookup for both halves; a context message can carry an image too.
          const attachmentsByMessage = await this.loadAttachments([
            ...window.map(m => m.messageId),
            ...context.map(m => m.messageId),
          ]);
          // Context first: labels follow the transcript the model reads, so T1
          // is the oldest thread in view rather than an arbitrary one.
          const threadLabels = buildThreadLabels(
            [...context, ...window],
            new Set(openItems.map(i => i.conversationId)),
            scope.isDmChannel,
          );
          const windowSenders = new Map(window.map(m => [m.messageId, m.senderId]));
          // Legal assignees: window mentions + senders, plus everyone already
          // involved in the thread's open items or the context tail — the
          // parser may infer an assignee from that history (user decision,
          // Aug 27).
          // A DM's legal assignees are its two participants and nobody else.
          // Not merely added to the derived set but REPLACING it: a third party
          // named in a DM cannot see that channel, so an item pending on them
          // is filtered out of their own feed and nobody ever actions it.
          // Deriving it would also leave the counterpart out entirely whenever
          // they have not spoken in the window, and directDmOwnerless would then
          // fall back to the author — filing the ask against whoever asked.
          const candidateUserIds = scope.isDmChannel
            ? dmParticipants
            : [
                ...new Set([
                  ...mentionedUserIds,
                  ...window.map(m => m.senderId),
                  ...openItems.flatMap(i => [...i.requested_by, ...i.pending_on]),
                  ...context.map(m => m.senderId).filter((id): id is string => id !== null),
                  ...[...contextMentions.values()].flat(),
                ]),
              ];
          const allowedUserIds = await this.realWorkspaceUsers(
            window[0].workspaceId,
            candidateUserIds,
          );
          const validationCtx = {
            openItems,
            windowSenders,
            // Mention ids are regex-scraped out of message HTML, so they are
            // attacker-authored: narrow them to ids that are really users in
            // this workspace before they can land in the ledger.
            allowedUserIds,
          };
          const transitions = await radarParser.parseWindow(
            openItems.map(({ conversationId, ...item }) =>
              threadLabels.size > 0
                ? { ...item, thread: threadLabels.get(conversationId) ?? null }
                : item,
            ),
            this.toParserMessages(window, mentionsByMessage, nameById, attachmentsByMessage, threadLabels),
            knownUsers,
            this.toParserMessages(context, contextMentions, nameById, attachmentsByMessage, threadLabels),
            undefined,
            // The validator doubles as the parser's semantic check: a reassign
            // it would drop as a no-op goes back to the model once, because
            // that drop nearly always means the wrong open item was matched.
            ops => noOpReassignFeedback(validateTransitions(ops, validationCtx).dropped, openItems),
          );
          run.proposedOps = transitions.operations;
          run.assessment = transitions.assessment;
          const { valid, dropped } = validateTransitions(transitions.operations, validationCtx);
          await this.directDmOwnerless(valid, scope, windowSenders, allowedUserIds);
          run.validOps = valid;
          // A repaired pass keeps its first attempt's rejects in the trail,
          // flagged, so the debug panel shows what the model was corrected on.
          run.droppedOps = transitions.repair
            ? [
                ...validateTransitions(transitions.repair.firstAttempt, validationCtx).dropped.map(
                  d => ({ ...d, repaired: true }),
                ),
                ...dropped,
              ]
            : dropped;
          const last = window[window.length - 1];
          const applied = await radarApplier.apply({
            workspaceId: last.workspaceId,
            conversationId,
            scope,
            conversationBySourceMessage: new Map(
              window.map(m => [m.messageId, m.conversationId]),
            ),
            operations: valid,
            watermark: { createdAt: last.createdAt, messageId: last.messageId },
            actorType: 'llm',
          });
          run.applied = applied;
          logger.info('[RADAR-EXECUTION] Applied transitions', {
            conversationId,
            ...applied,
            dropped,
          });
          await this.recordRun(run, startedAt);
          continue; // watermark advanced inside the apply transaction
        } catch (error) {
          run.error = error instanceof Error ? error.message : String(error);
          const failures = (state?.consecutiveFailures ?? 0) + 1;
          const last = window[window.length - 1];

          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            // Poison window. Holding the watermark is what makes a TRANSIENT
            // failure safe to retry, but it makes a DETERMINISTIC one bill
            // forever: every later message in the thread re-parses the same
            // content, and removeOnFail means the job vanishes so nothing
            // breaks the loop. Consume the window instead and let the thread
            // move on — the run log keeps the error for diagnosis.
            logger.error('[RADAR-EXECUTION] Skipping window after repeated parser failures', {
              conversationId,
              failures,
              windowSize: window.length,
              error: run.error,
            });
            run.error = `${run.error} (window skipped after ${failures} consecutive failures)`;
            await this.saveWatermark(scope.key, last, 0);
            await this.recordRun(run, startedAt);
            continue;
          }

          await this.saveWatermark(
            scope.key,
            { workspaceId: last.workspaceId, createdAt: floor.createdAt, messageId: floor.messageId },
            failures,
          );
          await this.recordRun(run, startedAt);
          throw error;
        }
      } else {
        logger.info('[RADAR-EXECUTION] Gate skip — untracked thread, no new @mention', {
          conversationId,
          windowSize: window.length,
          bootstrap: !state,
        });
      }

      // Consume the window either way, or it is re-scanned forever. On a gate
      // pass the advance happens inside the applier's transaction instead.
      await this.saveWatermark(scope.key, window[window.length - 1], 0);
      await this.recordRun(run, startedAt);
    }
  }

  /**
   * Failures are swallowed so the debug trail can never break the pipeline, but
   * awaited: an un-awaited insert per drain pass left an unbounded number of
   * writes in flight, each holding a pool connection.
   */
  /**
   * Watermark and failure count in one write. Passing the current floor back in
   * records a failure without consuming the window, keeping retries safe.
   */
  private async saveWatermark(
    scopeKey: string,
    at: { workspaceId: string; createdAt: Date; messageId: string },
    consecutiveFailures: number,
  ): Promise<void> {
    await prisma.executionThreadState.upsert({
      where: { conversationId: scopeKey },
      create: {
        conversationId: scopeKey,
        workspaceId: at.workspaceId,
        watermarkCreatedAt: at.createdAt,
        watermarkMsgId: at.messageId,
        consecutiveFailures,
      },
      update: {
        watermarkCreatedAt: at.createdAt,
        watermarkMsgId: at.messageId,
        consecutiveFailures,
      },
    });
  }

  private async recordRun(run: RunLogDraft, startedAt: number): Promise<void> {
    await prisma.executionRunLog
      .create({
        data: {
          workspaceId: run.workspaceId,
          conversationId: run.conversationId,
          gatePassed: run.gatePassed,
          gateReason: run.gateReason,
          windowSize: run.windowSize,
          parserRan: run.parserRan,
          proposedOps: run.proposedOps as object | undefined,
          validOps: run.validOps as object | undefined,
          droppedOps: run.droppedOps as object | undefined,
          applied: run.applied as object | undefined,
          assessment: run.assessment ?? null,
          error: run.error ?? null,
          durationMs: Date.now() - startedAt,
        },
      })
      .catch(error =>
        logger.warn('[RADAR-EXECUTION] Failed to record run log', {
          conversationId: run.conversationId,
          error,
        }),
      );
  }

  /**
   * DMs are implicitly directed: an ownerless create in a DM belongs to the
   * person being spoken to — the counterpart, or the author themself in a
   * self-DM (a note-to-self is always pending on its author). Deterministic
   * post-validation step, not LLM judgment: direction is structural in a DM.
   * Channel-thread ownerless items are untouched (genuinely unowned).
   */
  private async directDmOwnerless(
    valid: Array<{ op: string; sourceMessageId: string; pendingOn?: string[] }>,
    scope: RadarScope,
    windowSenders: Map<string, string>,
    allowedUserIds: Set<string>,
  ): Promise<void> {
    if (!scope.isDmChannel) return;
    const ownerless = valid.filter(
      op => op.op === 'create' && (op.pendingOn ?? []).length === 0,
    );
    if (ownerless.length === 0) return;

    const channel = await prisma.channel.findUnique({
      where: { id: scope.channelId },
      select: { participants: { select: { userId: true } } },
    });
    if (!channel) return;

    // This runs AFTER validateTransitions, so it has to re-apply the same
    // allow-list itself — otherwise a stale participant row would be the one
    // id that reaches the ledger unverified.
    const participants = channel.participants
      .map(p => p.userId)
      .filter(id => allowedUserIds.has(id));
    for (const op of ownerless) {
      const author = windowSenders.get(op.sourceMessageId);
      const counterparts = participants.filter(id => id !== author);
      const self = author && allowedUserIds.has(author) ? [author] : [];
      op.pendingOn = counterparts.length > 0 ? counterparts : self;
    }
  }

  /**
   * The last few already-consumed messages at/below the watermark, oldest
   * first — parser context only. Same visibility rules as the window
   * (visibleTo-restricted messages never enter Radar); the validator drops
   * any operation citing these ids, so context cannot produce transitions.
   */
  private async loadContextMessages(
    messageScope: Prisma.MessageWhereInput,
    floor: { createdAt: Date; messageId: string },
  ) {
    if (CONTEXT_MESSAGES <= 0) return [];
    const rows = await prisma.message.findMany({
      where: {
        ...messageScope,
        isDeleted: false,
        msgType: { not: 'SYSTEM' },
        visibleTo: null,
        OR: [
          { createdAt: { lt: floor.createdAt } },
          { createdAt: floor.createdAt, messageId: { lte: floor.messageId } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { messageId: 'desc' }],
      take: CONTEXT_MESSAGES,
      select: {
        messageId: true,
        senderId: true,
        content: true,
        createdAt: true,
        workspaceId: true,
        conversationId: true,
        conversation: { select: { initialMessageId: true } },
        sender: { select: { name: true } },
      },
    });
    return rows.reverse();
  }

  /**
   * The subset of candidate ids that are ACTIVE users of this workspace.
   * Everything upstream (mention scraping, the model's output) is untrusted
   * text; this is the last point before ids reach the ledger. Deactivated
   * accounts are excluded so a suspended user cannot be handed new work.
   */
  private async realWorkspaceUsers(
    workspaceId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();
    const users = await prisma.user.findMany({
      where: { id: { in: candidateIds }, workspaceId, status: ACTIVE_USER_STATUS },
      select: { id: true },
    });
    return new Set(users.map(u => u.id));
  }

  /** The DM's participants. The allow-list still runs over these, so a stale
   *  participant row or a deactivated account cannot reach the ledger. */
  private async dmParticipants(channelId: string): Promise<string[]> {
    const rows = await prisma.channelParticipant.findMany({
      where: { channelId },
      select: { userId: true },
    });
    return [...new Set(rows.map(r => r.userId))];
  }

  private async loadOpenItems(
    scope: RadarScope,
    conversationIdsInWindow: string[] = [],
  ): Promise<OpenItemRow[]> {
    // Newest first and bounded: every parse carries these, and a long-lived
    // thread accumulates open items faster than anyone resolves them.
    //
    // A DM reads its whole channel. Scoped to the conversation it would always
    // come back empty — the ask and the reply that settles it start separate
    // conversations — so no DM would ever count as tracked.
    // MAX_OPEN_ITEMS used to bound one thread; under DM scope it bounds a whole
    // channel, and newest-first alone would drop the items this window is about
    // as soon as a DM carries more than the cap. Items raised in a conversation
    // present in this window come first and are never squeezed out by a busier
    // sibling; the rest of the budget goes to the newest.
    const inWindow = new Set(conversationIdsInWindow);
    const items = await prisma.executionItem.findMany({
      where: scope.isDmChannel
        ? { channelId: scope.channelId, status: 'OPEN' }
        : { conversationId: scope.conversationId, status: 'OPEN' },
      orderBy: { updatedAt: 'desc' },
      take: MAX_OPEN_ITEMS,
      select: {
        id: true,
        title: true,
        contextSummary: true,
        requestedBy: true,
        pendingOn: true,
        conversationId: true,
      },
    });
    const relevant =
      inWindow.size > 0 && items.length === MAX_OPEN_ITEMS
        ? await prisma.executionItem.findMany({
            where: {
              channelId: scope.channelId,
              status: 'OPEN',
              conversationId: { in: [...inWindow] },
            },
            orderBy: { updatedAt: 'desc' },
            take: MAX_OPEN_ITEMS,
            select: {
              id: true,
              title: true,
              contextSummary: true,
              requestedBy: true,
              pendingOn: true,
              conversationId: true,
            },
          })
        : [];
    const merged = [...relevant, ...items.filter(i => !relevant.some(r => r.id === i.id))].slice(
      0,
      MAX_OPEN_ITEMS,
    );
    return merged.map(i => ({
      id: i.id,
      title: i.title,
      context: i.contextSummary,
      requested_by: i.requestedBy,
      pending_on: i.pendingOn,
      conversationId: i.conversationId,
    }));
  }

  /**
   * Pure shaping — the caller supplies nameById so one lookup serves the
   * window, the context tail and known_users. The model reasons over names but
   * must answer in ids, so each message carries both.
   */
  /**
   * Attachments as text. A message carrying only an image reaches the parser as
   * an empty string otherwise, and the model correctly reports there is nothing
   * in it — so an ask made as a screenshot is invisible to Radar. This does not
   * read the file; it says one exists, which is enough for the model to read it
   * together with the words around it.
   */
  private async loadAttachments(messageIds: string[]): Promise<Map<string, string[]>> {
    if (messageIds.length === 0) return new Map();
    const rows = await prisma.messageAttachment.findMany({
      where: {
        entityId: { in: messageIds },
        entityType: AttachmentEntityType.CHAT,
        isDeleted: false,
      },
      select: { entityId: true, originalFilename: true, mimetype: true },
    });
    const byMessage = new Map<string, string[]>();
    for (const row of rows) {
      const kind = row.mimetype.startsWith('image/')
        ? 'image'
        : row.mimetype.startsWith('video/')
          ? 'video'
          : 'file';
      const list = byMessage.get(row.entityId) ?? [];
      list.push(`[${kind}: ${row.originalFilename}]`);
      byMessage.set(row.entityId, list);
    }
    return byMessage;
  }

  private toParserMessages(
    window: Array<{
      messageId: string;
      senderId: string | null;
      content: string;
      createdAt: Date;
      conversationId: string;
      conversation: { initialMessageId: string } | null;
      sender: { name: string } | null;
    }>,
    mentionsByMessage: Map<string, string[]>,
    nameById: Map<string, string>,
    attachmentsByMessage: Map<string, string[]>,
    threadLabels: Map<string, string>,
  ): ParserWindowMessage[] {
    return window.map(m => ({
      id: m.messageId,
      author: { id: m.senderId ?? 'unknown', name: m.sender?.name ?? 'Unknown' },
      text: [stripHtml(m.content), ...(attachmentsByMessage.get(m.messageId) ?? [])]
        .filter(Boolean)
        .join(' '),
      mentions: (mentionsByMessage.get(m.messageId) ?? []).map(id => ({
        id,
        name: nameById.get(id) ?? id,
      })),
      timestamp_iso: m.createdAt.toISOString(),
      // Absent, not null. null is a CLAIM — the prompt reads it as "posted into
      // the main flow, not into any thread" — and only a flattened window is in
      // a position to make it. A thread-scoped window is one conversation, so it
      // says nothing about threads at all.
      ...(threadLabels.size > 0
        ? {
            thread: threadLabels.get(m.conversationId) ?? null,
            thread_role: (m.conversation && m.messageId === m.conversation.initialMessageId
              ? 'root'
              : 'reply') as 'root' | 'reply',
          }
        : {}),
    }));
  }
}

const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const radarExecutionService = new RadarExecutionService();
