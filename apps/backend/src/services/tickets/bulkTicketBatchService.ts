import { randomUUID } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { Prisma, type Ticket } from '@prisma/client';
import { generateNKeysBetween } from 'fractional-indexing';
import {
  BaseTicketType,
  TicketPriority,
  TicketStatusV2,
  mergeTicketEtaManagement,
  parseBoardEtaManagement,
  parseTicketEtaManagement,
  serializeTicketMd,
  buildInitialMessageMd,
  BulkTicketMode,
  MessageType,
  ConversationParticipation,
} from '@xyne/shared';
import type { TicketCardSummary } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { EntitySequenceService } from '@/services/entitySequenceService';
import { calculateETADeadline } from '@/utils/etaCalculation';
import {
  buildEtaActivityIntents,
  dispatchEtaNotifications,
  etaSignalsFromResult,
  evaluateEta,
  isTerminalStatus,
  resolveStepEstimate,
  writeEtaActivitiesPrisma,
} from '@/services/etaManagement';
import { emitTicketCreated } from '@/database/repositories/ticketRepository';
import { maybeCreateEntryApprovalRequest } from '@/services/stageTransition/stageEntryApproval';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';
import { dualWriteTicketTags } from '@/services/ticketTagDualWriteService';
import { websocketService } from '@/services/websocketService';
import { syncConversationSubTicketsMd } from '@/utils/ticketMd';
import { logger } from '@/utils/logger';

const prisma = DatabaseClient.getInstance();

/** The interactive-transaction client every commit step writes through. */
type BatchTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Namespace for deriving row ids from (batchKey, rowIndex). Fixed forever: a
 * retry must re-derive byte-identical ids for `skipDuplicates` to turn a replay
 * into a no-op. Changing it would make every in-flight job create duplicates.
 */
const BULK_TICKET_ID_NAMESPACE = '6f8d1a52-7b3c-4c19-9a4e-2f0f5c1d8e37';

/** Postgres handles a 100-row batch comfortably; Prisma's 5s default does not. */
const BATCH_TRANSACTION_TIMEOUT_MS = 120_000;
const BATCH_TRANSACTION_MAX_WAIT_MS = 15_000;

export interface BatchTicketInput {
  title: string;
  description?: string | undefined;
  channelId: string;
  projectId: string;
  boardId: string;
  assignedTo?: string | undefined;
  userGroupId?: string | undefined;
  eta?: Date | undefined;
  ticketType?: string | undefined;
  stageName?: string | undefined;
  priority?: string | undefined;
  statusV2?: string | undefined;
  merchantId?: string | undefined;
  clientRowId?: string | undefined;
}

export interface BatchTicketContext {
  createdBy: string;
  /**
   * Stable per-batch string (the queue job id). Row ids are derived from it, so
   * the same batch replayed produces the same ids and inserts nothing twice.
   */
  batchKey: string;
  fromTicketsTab?: boolean | undefined;
}

/** Everything about one row, fully resolved in memory before any write. */
interface PreparedRow {
  input: BatchTicketInput;
  index: number;
  ticketId: string;
  conversationId: string;
  messageId: string;
  participantId: string;
  stageVisitId: string | null;
  xyneId: string;
  workspaceId: string;
  stageId: string;
  stageName: string;
  kanbanPosition: string;
  statusV2: TicketStatusV2;
  priority: TicketPriority;
  eta: Date | null;
  metadata: Prisma.InputJsonValue;
  stageEnteredAt: Date;
  stageEtaDeadline: Date | null;
  doNotPostToChannel: boolean;
  description: string;
  etaActivityIntents: ReturnType<typeof buildEtaActivityIntents>;
  etaSignals: ReturnType<typeof etaSignalsFromResult>;
  ticketMd: string | null;
  messageContent: string;
  messageMetadata: Record<string, unknown>;
  initialMessageMd: string | null;
}

const deriveId = (batchKey: string, index: number, entity: string): string =>
  uuidv5(`${batchKey}:${index}:${entity}`, BULK_TICKET_ID_NAMESPACE);

const formatXyneId = (projectCode: string, sequenceNumber: number): string =>
  `${projectCode.toUpperCase()}-${String(sequenceNumber).padStart(4, '0')}`;

const distinct = <T>(values: T[]): T[] => Array.from(new Set(values));

/**
 * Shared, batch-invariant data. A bulk batch usually targets one channel, one
 * board and one project, so each of these is fetched once per distinct id
 * rather than once per row.
 */
interface SharedContext {
  channels: Map<string, { workspaceId: string; showTicketsTabTicketsInChat: boolean | null }>;
  boards: Map<
    string,
    {
      name: string;
      boardType: string;
      metadata: Prisma.JsonValue;
      stages: Array<{ id: string; name: string; eta: number | null; sequenceNumber: number }>;
      transitions: Awaited<ReturnType<typeof prisma.stageTransition.findMany>>;
    }
  >;
  projectCodes: Map<string, string>;
}

const loadSharedContext = async (rows: BatchTicketInput[]): Promise<SharedContext> => {
  const channelIds = distinct(rows.map((r) => r.channelId));
  const boardIds = distinct(rows.map((r) => r.boardId));
  const projectIds = distinct(rows.map((r) => r.projectId));

  const [channels, boards, stages, transitions, projects] = await Promise.all([
    prisma.channel.findMany({
      where: { id: { in: channelIds } },
      select: { id: true, workspaceId: true, showTicketsTabTicketsInChat: true },
    }),
    prisma.board.findMany({ where: { id: { in: boardIds } } }),
    prisma.stage.findMany({
      where: { boardId: { in: boardIds } },
      orderBy: { sequenceNumber: 'asc' },
    }),
    prisma.stageTransition.findMany({ where: { boardId: { in: boardIds } } }),
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, code: true },
    }),
  ]);

  const stagesByBoard = new Map<
    string,
    Array<{ id: string; name: string; eta: number | null; sequenceNumber: number }>
  >();
  for (const stage of stages) {
    const list = stagesByBoard.get(stage.boardId) ?? [];
    list.push(stage);
    stagesByBoard.set(stage.boardId, list);
  }

  const transitionsByBoard = new Map<
    string,
    Awaited<ReturnType<typeof prisma.stageTransition.findMany>>
  >();
  for (const transition of transitions) {
    const list = transitionsByBoard.get(transition.boardId) ?? [];
    list.push(transition);
    transitionsByBoard.set(transition.boardId, list);
  }

  return {
    channels: new Map(
      channels.map((c) => [
        c.id,
        { workspaceId: c.workspaceId, showTicketsTabTicketsInChat: c.showTicketsTabTicketsInChat },
      ])
    ),
    boards: new Map(
      boards.map((b) => [
        b.id,
        {
          name: b.name,
          boardType: b.boardType,
          metadata: b.metadata,
          stages: stagesByBoard.get(b.id) ?? [],
          transitions: transitionsByBoard.get(b.id) ?? [],
        },
      ])
    ),
    projectCodes: new Map(projects.map((p) => [p.id, p.code])),
  };
};

/**
 * Kanban keys for the whole batch. New tickets go to the top of their column,
 * so each (board, stage) group needs a chain of N keys below the column's
 * current head — one `generateKeyBetween` per row would hand every row in the
 * group the same key.
 */
const allocateKanbanPositions = async (
  groups: Array<{ boardId: string; stageName: string; count: number }>
): Promise<Map<string, string[]>> => {
  const entries = await Promise.all(
    groups.map(async ({ boardId, stageName, count }) => {
      const head = await prisma.ticket.findFirst({
        where: { boardId, stageName, kanbanPosition: { not: null } },
        orderBy: { kanbanPosition: 'asc' },
        select: { kanbanPosition: true },
      });
      let keys: string[];
      try {
        keys = generateNKeysBetween(null, head?.kanbanPosition ?? null, count);
      } catch {
        keys = generateNKeysBetween(null, null, count);
      }
      return [`${boardId}::${stageName}`, keys] as const;
    })
  );
  return new Map(entries);
};

/**
 * Resolve every row against the shared context, with no writes. Any problem
 * throws here — the batch is created as a whole or not at all, so a row that
 * cannot be built must stop the batch before the transaction opens.
 */
const prepareRows = async (
  rows: BatchTicketInput[],
  ctx: BatchTicketContext,
  shared: SharedContext
): Promise<PreparedRow[]> => {
  // One sequence block per distinct project, handed out in row order.
  const sequenceCursors = new Map<string, number>();
  for (const projectId of distinct(rows.map((r) => r.projectId))) {
    const count = rows.filter((r) => r.projectId === projectId).length;
    const block = await EntitySequenceService.reserveProjectTicketSequenceBlock(
      prisma,
      projectId,
      count
    );
    sequenceCursors.set(projectId, block.start);
  }

  // Stage selection has to happen before kanban keys, since the key chains are
  // grouped by the stage each row actually lands in.
  const stageByRow = rows.map((row) => {
    const board = shared.boards.get(row.boardId);
    if (!board) throw new Error(`Board ${row.boardId} not found`);
    if (board.stages.length === 0) {
      throw new Error(
        `No stages found for board ${row.boardId}. Board must have at least one stage.`
      );
    }
    const named = row.stageName ? board.stages.find((s) => s.name === row.stageName) : undefined;
    return named ?? board.stages[0]!;
  });

  const groupCounts = new Map<string, { boardId: string; stageName: string; count: number }>();
  rows.forEach((row, i) => {
    const key = `${row.boardId}::${stageByRow[i]!.name}`;
    const existing = groupCounts.get(key);
    if (existing) existing.count += 1;
    else groupCounts.set(key, { boardId: row.boardId, stageName: stageByRow[i]!.name, count: 1 });
  });

  const kanbanKeys = await allocateKanbanPositions(Array.from(groupCounts.values()));
  const kanbanCursors = new Map<string, number>();

  const batchStartedAt = new Date();

  return rows.map((input, index) => {
    // One millisecond apart, in request order. A single shared timestamp leaves
    // the batch's messages tied in the channel and the parent's sub-ticket
    // cards (ordered by createdAt) in arbitrary order.
    const now = new Date(batchStartedAt.getTime() + index);
    const channel = shared.channels.get(input.channelId);
    if (!channel) throw new Error(`Channel not found: ${input.channelId}`);
    const board = shared.boards.get(input.boardId)!;
    const projectCode = shared.projectCodes.get(input.projectId);
    if (!projectCode) throw new Error(`Project not found: ${input.projectId}`);

    const selectedStage = stageByRow[index]!;
    const groupKey = `${input.boardId}::${selectedStage.name}`;
    const cursor = kanbanCursors.get(groupKey) ?? 0;
    kanbanCursors.set(groupKey, cursor + 1);
    const kanbanPosition = kanbanKeys.get(groupKey)![cursor]!;

    const sequenceNumber = sequenceCursors.get(input.projectId)!;
    sequenceCursors.set(input.projectId, sequenceNumber + 1);

    const ticketId = deriveId(ctx.batchKey, index, 'ticket');
    const conversationId = deriveId(ctx.batchKey, index, 'conversation');
    const messageId = deriveId(ctx.batchKey, index, 'message');
    const participantId = deriveId(ctx.batchKey, index, 'participant');

    const statusV2 = (input.statusV2 as TicketStatusV2) || TicketStatusV2.TODO;
    const priority = (input.priority?.toUpperCase() as TicketPriority) || TicketPriority.MEDIUM;

    // The stage visit row is only written when the stage tracks an ETA, but its
    // id must exist before evaluateEta runs — that call reads it as the active
    // visit it is deciding about.
    const tracksStageEta = selectedStage.eta !== null && selectedStage.eta > 0;
    const stageVisitId = tracksStageEta ? deriveId(ctx.batchKey, index, 'stageEta') : null;
    const stageEtaDeadline = tracksStageEta ? calculateETADeadline(now, selectedStage.eta!) : null;

    const stepEstimate = resolveStepEstimate(
      { id: selectedStage.id, eta: selectedStage.eta },
      null,
      { requireExplicitTransition: false }
    );

    // Pure, so the final eta and metadata are known before the insert. The
    // row-at-a-time path has to insert then update; here one insert is enough.
    const etaResult = evaluateEta({
      ticketId,
      ticketStatus: statusV2,
      isTerminal: isTerminalStatus(statusV2),
      currentTicketEta: input.eta ?? null,
      currentTicketEtaManagement: parseTicketEtaManagement({}),
      boardType: board.boardType,
      boardEtaManagement: parseBoardEtaManagement(board.metadata, board.boardType),
      currentStageId: selectedStage.id,
      stages: board.stages,
      transitions: board.transitions,
      activeVisit: {
        stageVisitId,
        transitionId: null,
        deadline: stageEtaDeadline,
        deadlineTracked: stageVisitId !== null,
        estimateSource: stepEstimate.source,
        estimateHours: stepEstimate.incomplete ? null : stepEstimate.hours,
      },
      trigger: 'CREATE',
      now,
    } as Parameters<typeof evaluateEta>[0]);

    const eta =
      etaResult.etaDecision.changed && etaResult.etaDecision.newEta
        ? etaResult.etaDecision.newEta
        : (input.eta ?? null);
    const metadata = mergeTicketEtaManagement({}, etaResult.ticketEtaManagementPatch);

    const description = input.description ?? '';

    const messageContent = `Ticket created in ${board.name || 'Unknown Board'}: ${input.title}`;
    const messageMetadata: Record<string, unknown> = {
      messageSubtype: 'bulk_ticket',
      ticketId,
      xyneId: formatXyneId(projectCode, sequenceNumber),
      isAiGenerated: true,
    };

    const ticketMd = serializeTicketMd({
      id: ticketId,
      title: input.title,
      description,
      statusV2: statusV2 as TicketCardSummary['statusV2'],
      priority: priority as TicketCardSummary['priority'],
      assignedTo: input.assignedTo ?? null,
      createdBy: ctx.createdBy,
      createdAt: now.getTime(),
      eta: eta ? eta.getTime() : null,
      xyneId: formatXyneId(projectCode, sequenceNumber),
      stageName: selectedStage.name,
      ticketType: input.ticketType ?? null,
      channelId: input.channelId,
      conversationId,
    });

    // Same snapshot syncInitialMessageMd would compute after the fact, built
    // here from the message this batch is about to write. Going through the
    // shared builder is mandatory: a writer that serialises differently
    // silently rewrites the md on every conversation it touches.
    const initialMessageMd = buildInitialMessageMd({
      messageId,
      conversationId,
      workspaceId: channel.workspaceId,
      senderId: ctx.createdBy,
      content: messageContent,
      msgType: MessageType.SYSTEM as Parameters<typeof buildInitialMessageMd>[0]['msgType'],
      showInChannel: false,
      createdAt: now.getTime(),
      metadata: messageMetadata,
    });

    return {
      input,
      index,
      ticketId,
      conversationId,
      messageId,
      participantId,
      stageVisitId,
      xyneId: formatXyneId(projectCode, sequenceNumber),
      workspaceId: channel.workspaceId,
      stageId: selectedStage.id,
      stageName: selectedStage.name,
      kanbanPosition,
      statusV2,
      priority,
      eta,
      metadata: metadata as Prisma.InputJsonValue,
      stageEnteredAt: now,
      stageEtaDeadline,
      doNotPostToChannel:
        ctx.fromTicketsTab === true && channel.showTicketsTabTicketsInChat === false,
      description,
      etaActivityIntents: buildEtaActivityIntents(etaResult, {
        currentStageId: selectedStage.id,
        oldEta: input.eta ? input.eta.getTime() : null,
        trigger: 'CREATE',
        systemReason: 'Automatic ETA set on ticket creation',
        previousRiskFingerprint: null,
      } as Parameters<typeof buildEtaActivityIntents>[1]),
      etaSignals: etaSignalsFromResult(etaResult),
      ticketMd,
      messageContent,
      messageMetadata,
      initialMessageMd,
    };
  });
};

/** Every insert for the batch, in FK order. Runs inside the caller's transaction. */
const commitRows = async (
  tx: BatchTransaction,
  prepared: PreparedRow[],
  ctx: BatchTicketContext
): Promise<void> => {
  // Batch-wide writes only; every per-row timestamp comes off the row itself.
  const latest = prepared[prepared.length - 1]?.stageEnteredAt ?? new Date();
  const merchantIds = distinct(
    prepared.map((r) => r.input.merchantId).filter((m): m is string => Boolean(m))
  );

  if (merchantIds.length > 0) {
    await tx.merchant.createMany({
      data: merchantIds.map((mid) => ({ mid })),
      skipDuplicates: true,
    });
  }

  // `conversation.ticketId` carries no FK constraint and ticket_md is fully
  // computed above, so conversations land complete in one insert instead of
  // create-then-update once the ticket exists.
  await tx.conversation.createMany({
    data: prepared.map((r) => ({
      conversationId: r.conversationId,
      channelId: r.input.channelId,
      workspaceId: r.workspaceId,
      createdBy: ctx.createdBy,
      initialMessageId: r.messageId,
      doNotPostToChannel: r.doNotPostToChannel,
      pinned: false,
      ticketId: r.ticketId,
      ticket_md: r.ticketMd,
      initial_message_md: r.initialMessageMd,
      replyCount: 1,
      lastActivityAt: r.stageEnteredAt,
      createdAt: r.stageEnteredAt,
    })),
    skipDuplicates: true,
  });

  await tx.ticket.createMany({
    data: prepared.map((r) => ({
      id: r.ticketId,
      title: r.input.title,
      description: r.description,
      createdBy: ctx.createdBy,
      updatedBy: ctx.createdBy,
      assignedTo: r.input.assignedTo ?? null,
      conversationId: r.conversationId,
      messageId: r.messageId,
      channelId: r.input.channelId,
      xyneId: r.xyneId,
      projectId: r.input.projectId,
      workspaceId: r.workspaceId,
      userGroupId: r.input.userGroupId ?? null,
      boardId: r.input.boardId,
      stageName: r.stageName,
      statusV2: r.statusV2,
      priority: r.priority,
      ...(r.eta ? { eta: r.eta } : {}),
      metadata: r.metadata,
      merchantId: r.input.merchantId ?? null,
      ticketType: r.input.ticketType ?? null,
      kanbanPosition: r.kanbanPosition,
      createdAt: r.stageEnteredAt,
      lastEmailAt: r.stageEnteredAt,
    })),
    skipDuplicates: true,
  });

  await tx.ticketDescription.createMany({
    data: prepared.map((r) => ({
      ticketId: r.ticketId,
      workspaceId: r.workspaceId,
      channelId: r.input.channelId,
      description: r.description,
      createdAt: r.stageEnteredAt,
      updatedAt: r.stageEnteredAt,
    })),
    skipDuplicates: true,
  });

  await tx.message.createMany({
    data: prepared.map((r) => ({
      messageId: r.messageId,
      conversationId: r.conversationId,
      senderId: ctx.createdBy,
      workspaceId: r.workspaceId,
      content: r.messageContent,
      msgType: MessageType.SYSTEM,
      showInChannel: false,
      createdAt: r.stageEnteredAt,
      metadata: r.messageMetadata as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });

  // Fresh conversations have no participants yet, so the creator row is
  // always an insert — the row-at-a-time path pays for an upsert plus an
  // updateMany that can never match anything.
  await tx.conversationParticipant.createMany({
    data: prepared.map((r) => ({
      id: r.participantId,
      conversationId: r.conversationId,
      userId: ctx.createdBy,
      workspaceId: r.workspaceId,
      participationType: ConversationParticipation.MENTIONED,
      isSubscribed: true,
      joinedAt: r.stageEnteredAt,
      lastReplyAt: r.stageEnteredAt,
      channelId: r.input.channelId,
    })),
    skipDuplicates: true,
  });

  const stageEtaRows = prepared.filter((r) => r.stageVisitId && r.stageEtaDeadline);
  if (stageEtaRows.length > 0) {
    await tx.ticketStageEta.createMany({
      data: stageEtaRows.map((r) => ({
        id: r.stageVisitId!,
        ticketId: r.ticketId,
        workspaceId: r.workspaceId,
        stageId: r.stageId,
        stageEnteredAt: r.stageEnteredAt,
        stageLeftAt: null,
        stageEta: r.stageEtaDeadline!,
        updatedBy: ctx.createdBy,
      })),
      skipDuplicates: true,
    });
  }

  const hotfixRows = prepared.filter((r) => r.input.ticketType === BaseTicketType.Hotfix);
  if (hotfixRows.length > 0) {
    await tx.ticketTag.createMany({
      data: hotfixRows.map((r) => ({
        ticketId: r.ticketId,
        workspaceId: r.workspaceId,
        name: 'hotfix',
      })),
      skipDuplicates: true,
    });
  }

  await tx.channel.updateMany({
    where: { id: { in: distinct(prepared.map((r) => r.input.channelId)) } },
    data: { lastActivityAt: latest },
  });

  // Normally empty on CREATE: only boards with automatic ETA management
  // produce intents here, so this stays a no-op for the common batch.
  const withIntents = prepared.filter((r) => r.etaActivityIntents.length > 0);
  for (const row of withIntents) {
    await writeEtaActivitiesPrisma(tx as Prisma.TransactionClient, row.etaActivityIntents, {
      ticketId: row.ticketId,
      workspaceId: row.workspaceId,
      channelId: row.input.channelId,
      conversationId: row.conversationId,
      timestamp: row.stageEnteredAt.getTime(),
    } as Parameters<typeof writeEtaActivitiesPrisma>[2]);
  }
};

/**
 * Side effects that must not run until the rows are committed, and must never
 * be able to fail the batch that already succeeded.
 */
const fanOut = (prepared: PreparedRow[], ctx: BatchTicketContext): void => {
  const hotfixIds = prepared
    .filter((r) => r.input.ticketType === BaseTicketType.Hotfix)
    .map((r) => r.ticketId);
  for (const ticketId of hotfixIds) {
    void dualWriteTicketTags(ticketId, ['hotfix']).catch((error: unknown) => {
      logger.error('[BulkTicketBatch] Hotfix tag dual-write failed', { ticketId, error });
    });
  }

  for (const row of prepared) {
    // Automations read the ticket back on their own connection, so this can only
    // run now that the transaction has committed.
    void emitTicketCreated(
      { id: row.ticketId, workspaceId: row.workspaceId },
      undefined,
      ctx.createdBy
    );

    // Ticket committed on its initial stage — auto-create the on-entry approval
    // request if that stage's single outgoing transition is configured for it.
    void maybeCreateEntryApprovalRequest(row.ticketId, ctx.createdBy, row.stageName);

    ticketDuplicateService
      .persistDuplicateReferences({
        ticketId: row.ticketId,
        ticketCreatedBy: ctx.createdBy,
        title: row.input.title,
        description: row.description,
        projectId: row.input.projectId,
        userId: ctx.createdBy,
      })
      .catch((error: Error) => {
        logger.error('[BulkTicketBatch] Failed to persist duplicate references', {
          ticketId: row.ticketId,
          error,
        });
      });

    if (row.statusV2 !== TicketStatusV2.PAUSED) {
      void dispatchEtaNotifications(row.etaSignals, {
        ticketId: row.ticketId,
        createdBy: ctx.createdBy,
        assignedTo: row.input.assignedTo ?? null,
        ticketUserGroupId: row.input.userGroupId ?? null,
        boardId: row.input.boardId,
        actorId: ctx.createdBy,
      } as Parameters<typeof dispatchEtaNotifications>[1]).catch((error: unknown) => {
        logger.error('[BulkTicketBatch] Failed to dispatch ETA notifications', {
          ticketId: row.ticketId,
          error,
        });
      });
    }

    // Counts come straight from the prepared row: a just-created ticket has no
    // tags, assignments or form values to read back.
    websocketService.broadcastTicketCountsUpdate({
      operation: 'insert',
      ticket: {
        id: row.ticketId,
        workspaceId: row.workspaceId,
        boardId: row.input.boardId,
        channelId: row.input.channelId,
        projectId: row.input.projectId,
        stageName: row.stageName,
        statusV2: row.statusV2,
        priority: row.priority,
        assignedTo: row.input.assignedTo ?? null,
        createdBy: ctx.createdBy,
        userGroupId: row.input.userGroupId ?? null,
        ticketType: row.input.ticketType ?? null,
        merchantId: row.input.merchantId ?? null,
        isStageOverdue: false,
        eta: row.eta?.getTime() ?? null,
        createdAt: row.stageEnteredAt.getTime(),
        prReviewers: [],
        tags: row.input.ticketType === BaseTicketType.Hotfix ? ['hotfix'] : [],
        assignments: [],
        formValues: [],
      } as Parameters<typeof websocketService.broadcastTicketCountsUpdate>[0]['ticket'],
    });
  }

  for (const channelId of distinct(prepared.map((r) => r.input.channelId))) {
    websocketService.broadcastLabelUnreadCountsUpdate(channelId);
  }
};

export interface BulkBatchRequest {
  mode: BulkTicketMode;
  /** Parent to create as part of this batch (parent-sub mode, new parent). */
  parent?: BatchTicketInput | undefined;
  /** Parent that already exists (parent-sub mode, linking to it). */
  existingParentTicketId?: string | undefined;
  children: BatchTicketInput[];
}

export interface BulkBatchResult {
  parentTicketId: string | null;
  /** The children, in request order. Excludes a parent created by this batch. */
  tickets: Ticket[];
}

/** Sub-ticket rows and their parent mappings, inside the caller's transaction. */
const commitSubTicketLinks = async (
  tx: BatchTransaction,
  parent: { id: string; conversationId: string; workspaceId: string },
  children: PreparedRow[],
  ctx: BatchTicketContext
): Promise<void> => {
  if (children.length === 0) return;

  // Keyed on the child's own row index, so the ids a retry derives are the same
  // ones the first attempt used.
  const rows = children.map((child) => ({
    child,
    subTicketId: deriveId(ctx.batchKey, child.index, 'subTicket'),
    mappingId: deriveId(ctx.batchKey, child.index, 'subTicketMapping'),
  }));

  await tx.subTicket.createMany({
    data: rows.map(({ child, subTicketId }) => ({
      id: subTicketId,
      title: child.input.title,
      description: child.description,
      mappedTicketId: child.ticketId,
      createdBy: ctx.createdBy,
      updatedBy: ctx.createdBy,
      conversationId: parent.conversationId,
      workspaceId: parent.workspaceId,
      assignedTo: child.input.assignedTo ?? null,
      createdAt: child.stageEnteredAt,
      updatedAt: child.stageEnteredAt,
    })),
    skipDuplicates: true,
  });

  await tx.ticketSubTicketMapping.createMany({
    data: rows.map(({ subTicketId, mappingId }) => ({
      id: mappingId,
      ticketId: parent.id,
      subTicketId,
      workspaceId: parent.workspaceId,
    })),
    skipDuplicates: true,
  });
};

/**
 * Create a whole bulk request — the parent (if this batch makes one), every
 * child, the sub-ticket links and the parent's rebuilt card — in one
 * transaction.
 *
 * End-to-end atomic: the request commits completely or leaves nothing behind.
 * There is deliberately no per-row recovery, so every row is resolved and
 * validated against shared context first and anything unusable throws before
 * the transaction opens.
 *
 * Replaying the same `batchKey` is a no-op: row ids are derived from it, so
 * `skipDuplicates` swallows rows a previous attempt already committed.
 */
export const createBulkTicketBatch = async (
  request: BulkBatchRequest,
  ctx: BatchTicketContext
): Promise<BulkBatchResult> => {
  const allRows = request.parent ? [request.parent, ...request.children] : request.children;
  if (allRows.length === 0) {
    return { parentTicketId: request.existingParentTicketId ?? null, tickets: [] };
  }

  const shared = await loadSharedContext(allRows);
  // Prepared as one list so the parent and its children share a single sequence
  // reservation and one kanban key chain per column, and so every derived id
  // comes from the same index space.
  const prepared = await prepareRows(allRows, ctx, shared);
  const parentRow = request.parent ? prepared[0]! : null;
  const childRows = request.parent ? prepared.slice(1) : prepared;

  let parentLink: { id: string; conversationId: string; workspaceId: string } | null = null;
  if (parentRow) {
    parentLink = {
      id: parentRow.ticketId,
      conversationId: parentRow.conversationId,
      workspaceId: parentRow.workspaceId,
    };
  } else if (request.existingParentTicketId) {
    const existing = await prisma.ticket.findUnique({
      where: { id: request.existingParentTicketId },
      select: { id: true, conversationId: true, workspaceId: true },
    });
    if (!existing) {
      throw new Error(`Parent ticket "${request.existingParentTicketId}" not found`);
    }
    parentLink = existing;
  }

  await prisma.$transaction(
    async (tx) => {
      await commitRows(tx, prepared, ctx);

      if (request.mode === BulkTicketMode.PARENT_SUB && parentLink) {
        await commitSubTicketLinks(tx, parentLink, childRows, ctx);
        // Reads back the rows just inserted above, so it must stay inside this
        // transaction — and running it once is the whole point: the per-item
        // path re-serialises the parent's entire child list on every insert.
        await syncConversationSubTicketsMd(tx, parentLink.id);
      }
    },
    { timeout: BATCH_TRANSACTION_TIMEOUT_MS, maxWait: BATCH_TRANSACTION_MAX_WAIT_MS }
  );

  fanOut(prepared, ctx);

  logger.info('[BulkTicketBatch] Batch committed', {
    batchKey: ctx.batchKey,
    children: childRows.length,
    createdParent: parentRow !== null,
    parentTicketId: parentLink?.id ?? null,
  });

  // Callers pair results back to their inputs positionally, and `findMany` does
  // not honour the order of an `in` list.
  const created = await prisma.ticket.findMany({
    where: { id: { in: childRows.map((r) => r.ticketId) } },
  });
  const byId = new Map(created.map((ticket) => [ticket.id, ticket]));

  return {
    parentTicketId: parentLink?.id ?? null,
    tickets: childRows
      .map((r) => byId.get(r.ticketId))
      .filter((ticket): ticket is Ticket => ticket !== undefined),
  };
};

/** Exported for tests: id derivation must stay stable across releases. */
export const __testing = { deriveId, formatXyneId, randomUUID };
