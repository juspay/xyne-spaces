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
import { validateTransitions } from '@/services/radar/radarValidator';
import { radarApplier } from '@/services/radar/radarApplier';

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

class RadarExecutionService {
  async processThread(conversationId: string): Promise<void> {
    for (;;) {
      const state = await prisma.executionThreadState.findUnique({
        where: { conversationId },
      });

      const floor = state
        ? { createdAt: state.watermarkCreatedAt, messageId: state.watermarkMsgId }
        : { createdAt: new Date(Date.now() - BOOTSTRAP_LOOKBACK_MS), messageId: '' };

      const window = await prisma.message.findMany({
        where: {
          conversationId,
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
          sender: { select: { name: true } },
        },
      });

      if (window.length === 0) {
        return; // drained — the job may complete
      }

      // Gate: two deterministic branches — a tracked thread (any reply may
      // move a ball), or an untracked one with a resolved @mention. No
      // heuristics; the only probabilistic judgment belongs to the parser.
      const openItems = await this.loadOpenItems(conversationId);
      const tracked = openItems.length > 0;

      // Per-message mentions feed both the gate and the parser's closed
      // assignment sources (pendingOn may only come from these + self-claim).
      const mentionsByMessage = new Map(
        window.map(m => [m.messageId, extractUserMentions(m.content)]),
      );
      const mentionedUserIds = [...new Set([...mentionsByMessage.values()].flat())];
      const gatePassed = tracked || mentionedUserIds.length > 0;

      // Debug trail for the Radar debug panel: one row per drain pass,
      // written best-effort — observability must never break the pipeline.
      const startedAt = Date.now();
      const run: RunLogDraft = {
        workspaceId: window[0].workspaceId,
        conversationId,
        gatePassed,
        gateReason: gatePassed ? (tracked ? 'tracked-thread' : 'new-mention') : 'skip',
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
          const context = await this.loadContextMessages(conversationId, floor);
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
          const transitions = await radarParser.parseWindow(
            openItems,
            this.toParserMessages(window, mentionsByMessage, nameById, attachmentsByMessage),
            knownUsers,
            this.toParserMessages(context, contextMentions, nameById, attachmentsByMessage),
          );
          run.proposedOps = transitions.operations;
          run.assessment = transitions.assessment;
          const windowSenders = new Map(window.map(m => [m.messageId, m.senderId]));
          // Legal assignees: window mentions + senders, plus everyone already
          // involved in the thread's open items or the context tail — the
          // parser may infer an assignee from that history (user decision,
          // Aug 27).
          const candidateUserIds = [
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
          const { valid, dropped } = validateTransitions(transitions.operations, {
            openItems,
            windowSenders,
            // Mention ids are regex-scraped out of message HTML, so they are
            // attacker-authored: narrow them to ids that are really users in
            // this workspace before they can land in the ledger.
            allowedUserIds,
          });
          await this.directDmOwnerless(valid, conversationId, windowSenders, allowedUserIds);
          run.validOps = valid;
          run.droppedOps = dropped;
          const last = window[window.length - 1];
          const conversation = await prisma.conversation.findUniqueOrThrow({
            where: { conversationId },
            select: { channelId: true },
          });
          const applied = await radarApplier.apply({
            workspaceId: last.workspaceId,
            conversationId,
            channelId: conversation.channelId,
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
            await this.saveWatermark(conversationId, last, 0);
            await this.recordRun(run, startedAt);
            continue;
          }

          await this.saveWatermark(
            conversationId,
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
      await this.saveWatermark(conversationId, window[window.length - 1], 0);
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
    conversationId: string,
    at: { workspaceId: string; createdAt: Date; messageId: string },
    consecutiveFailures: number,
  ): Promise<void> {
    await prisma.executionThreadState.upsert({
      where: { conversationId },
      create: {
        conversationId,
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
    conversationId: string,
    windowSenders: Map<string, string>,
    allowedUserIds: Set<string>,
  ): Promise<void> {
    const ownerless = valid.filter(
      op => op.op === 'create' && (op.pendingOn ?? []).length === 0,
    );
    if (ownerless.length === 0) return;

    const conversation = await prisma.conversation.findUnique({
      where: { conversationId },
      select: {
        channel: {
          select: { scopeType: true, participants: { select: { userId: true } } },
        },
      },
    });
    if (conversation?.channel?.scopeType !== 'DM') return;

    // This runs AFTER validateTransitions, so it has to re-apply the same
    // allow-list itself — otherwise a stale participant row would be the one
    // id that reaches the ledger unverified.
    const participants = conversation.channel.participants
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
    conversationId: string,
    floor: { createdAt: Date; messageId: string },
  ) {
    if (CONTEXT_MESSAGES <= 0) return [];
    const rows = await prisma.message.findMany({
      where: {
        conversationId,
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

  private async loadOpenItems(conversationId: string): Promise<ParserOpenItem[]> {
    // Newest first and bounded: every parse carries these, and a long-lived
    // thread accumulates open items faster than anyone resolves them.
    const items = await prisma.executionItem.findMany({
      where: { conversationId, status: 'OPEN' },
      orderBy: { updatedAt: 'desc' },
      take: MAX_OPEN_ITEMS,
      select: {
        id: true,
        title: true,
        contextSummary: true,
        requestedBy: true,
        pendingOn: true,
      },
    });
    return items.map(i => ({
      id: i.id,
      title: i.title,
      context: i.contextSummary,
      requested_by: i.requestedBy,
      pending_on: i.pendingOn,
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
      sender: { name: string } | null;
    }>,
    mentionsByMessage: Map<string, string[]>,
    nameById: Map<string, string>,
    attachmentsByMessage: Map<string, string[]>,
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
