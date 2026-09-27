import { randomUUID } from 'crypto';
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
  BoardType,
  ActivityType,
  MessageType,
  ConversationParticipation,
} from '@xyne/shared';
import type { TicketCardSummary, BoardMetadata } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { EntitySequenceService } from '@/services/entitySequenceService';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import {
  buildEtaActivityIntents,
  dispatchEtaNotifications,
  etaSignalsFromResult,
  evaluateEta,
  isTerminalStatus,
  resolveStepEstimate,
  writeEtaActivitiesPrisma,
} from '@/services/etaManagement';
import {
  emitTicketCreated,
  makeFallbackCountsSnapshot,
} from '@/database/repositories/ticketRepository';
import { maybeCreateEntryApprovalRequest } from '@/services/stageTransition/stageEntryApproval';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';
import { ticketAssignmentService, primaryUserIdOf } from '@/services/ticketAssignmentService';
import { dualWriteTicketTags } from '@/services/ticketTagDualWriteService';
import { websocketService } from '@/services/websocketService';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { messageClassificationQueue } from '@/queues/messageClassificationQueue';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema } from '@/vespa/src/types';
import {
  syncConversationSubTicketsMd,
  syncConversationTicketMdFromPrismaTicket,
  linkSubTicketConversationToParent,
} from '@/utils/ticketMd';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { resolveInheritedOwner, linkCreatedEntities } from '@/sdlc/entityLinkService';
import { advisoryXactLock } from '@/bypassAcl/lockServices';
import { logger } from '@/utils/logger';

const prisma = DatabaseClient.getInstance();

/** The interactive-transaction client every commit step writes through. */
type BatchTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Comfortable for a batch this size; Prisma's 5s default is not. */
const BATCH_TRANSACTION_TIMEOUT_MS = 30_000;
const BATCH_TRANSACTION_MAX_WAIT_MS = 5_000;

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
  /** Tenant the batch belongs to; scopes the read that builds the response. */
  workspaceId: string;
  /**
   * Conversation the batch was started from, when there is one. Its SDLC owner
   * is inherited by every ticket created here, the same way single-ticket
   * creation inherits from the conversation it was raised in.
   */
  sourceConversationId?: string | undefined;
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
  statusV2: TicketStatusV2;
  priority: TicketPriority;
  /** Resolved against the board type — see the FLOW rules in prepareRows. */
  ticketType: string | null;
  /** Resolved from the assignment rule when only a group was given. */
  assignedTo: string | null;
  /** Board wants role-driven assignment, which can only run post-commit. */
  needsFullRoleAssignment: boolean;
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

/**
 * Mirrors TicketIdService's project-scoped format. Deliberately local: that
 * one is private, and bulk creation only needs to render numbers it already
 * reserved as a block — not to allocate any.
 */
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
 * Kanban keys for the whole batch, allocated inside the caller's transaction.
 *
 * New tickets go to the top of their column, so each (board, stage) group needs
 * a chain of N keys below the column's current head — one `generateKeyBetween`
 * per row would hand every row in the group the same key.
 *
 * The column head is read under a per-column advisory lock held to commit.
 * Without it two concurrent batches read the same head and mint identical
 * fractional keys: `kanbanPosition` has no unique constraint, so nothing would
 * reject them and the column's order becomes ambiguous. Reading inside the
 * transaction alone is not enough — at READ COMMITTED both would still see the
 * same row.
 */
const allocateKanbanPositions = async (
  tx: BatchTransaction,
  prepared: PreparedRow[]
): Promise<Map<number, string>> => {
  const groups = new Map<string, PreparedRow[]>();
  for (const row of prepared) {
    const key = `${row.input.boardId}::${row.stageName}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const positions = new Map<number, string>();
  // Sequential, and in a stable key order: two batches touching the same pair of
  // columns must take those locks in the same order or they can deadlock.
  for (const groupKey of Array.from(groups.keys()).sort()) {
    const rowsInGroup = groups.get(groupKey)!;
    const first = rowsInGroup[0]!;

    await advisoryXactLock(
      tx as Prisma.TransactionClient,
      ['Ticket'],
      'serializes kanban position allocation per (board, stage) column',
      groupKey
    );

    const head = await tx.ticket.findFirst({
      where: {
        boardId: first.input.boardId,
        stageName: first.stageName,
        kanbanPosition: { not: null },
      },
      orderBy: { kanbanPosition: 'asc' },
      select: { kanbanPosition: true },
    });

    let keys: string[];
    try {
      keys = generateNKeysBetween(null, head?.kanbanPosition ?? null, rowsInGroup.length);
    } catch {
      keys = generateNKeysBetween(null, null, rowsInGroup.length);
    }
    rowsInGroup.forEach((row, i) => positions.set(row.index, keys[i]!));
  }

  return positions;
};

/**
 * Resolve every row against the shared context, with no writes. Any problem
 * throws here — the batch is created as a whole or not at all, so a row that
 * cannot be built must stop the batch before the transaction opens.
 */
const prepareRows = async (
  rows: BatchTicketInput[],
  ctx: BatchTicketContext,
  shared: SharedContext,
  /** Indices that hang under a parent; only these escape the FLOW Epic rule. */
  subTicketIndices: ReadonlySet<number>
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

  // Stage selection drives which column a row lands in, which is what the
  // commit-time kanban allocation groups by.
  const stageByRow = rows.map((row) => {
    const board = shared.boards.get(row.boardId);
    if (!board) throw new Error(`Board ${row.boardId} not found`);
    if (board.stages.length === 0) {
      throw new Error(
        `No stages found for board ${row.boardId}. Board must have at least one stage.`
      );
    }
    // A FLOW board always starts at TODO; the requested stage is ignored, the
    // same normalization single-ticket creation applies.
    const wantedStageName = board.boardType === BoardType.FLOW ? 'TODO' : row.stageName;
    const named = wantedStageName
      ? board.stages.find((s) => s.name === wantedStageName)
      : undefined;
    return named ?? board.stages[0]!;
  });

  // A row that names only a group has to be turned into a real assignee, exactly
  // as single-ticket creation does — otherwise the ticket lands unassigned and
  // no assignment rule ever runs. Boards configured for role-driven assignment
  // defer instead: that path needs a committed ticket id.
  const assignments = await Promise.all(
    rows.map(async (row) => {
      if (row.assignedTo || !row.userGroupId) {
        return { assignedTo: row.assignedTo ?? null, needsFullRoleAssignment: false };
      }
      const board = shared.boards.get(row.boardId);
      const boardMeta = board?.metadata as BoardMetadata | undefined;
      if (
        (Array.isArray(boardMeta?.assignmentRoles) && boardMeta.assignmentRoles.length > 0) ||
        boardMeta?.fullRoleAssignment === true
      ) {
        return { assignedTo: null, needsFullRoleAssignment: true };
      }
      try {
        const result = await evaluateAssignmentRule(
          row.userGroupId,
          row.boardId,
          undefined,
          undefined,
          row.projectId
        );
        return { assignedTo: result.assignedUserId ?? null, needsFullRoleAssignment: false };
      } catch (error) {
        // Same posture as single creation: an assignment failure must not stop
        // the ticket from being created.
        logger.error('[BulkTicketBatch] Auto-assignment failed', {
          userGroupId: row.userGroupId,
          boardId: row.boardId,
          error,
        });
        return { assignedTo: null, needsFullRoleAssignment: false };
      }
    })
  );

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
    const sequenceNumber = sequenceCursors.get(input.projectId)!;
    sequenceCursors.set(input.projectId, sequenceNumber + 1);

    const ticketId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const participantId = randomUUID();

    // FLOW boards drive status through the flow itself and expect their roots to
    // be Epics; a sub-ticket hangs under a parent so it keeps its own type.
    const { assignedTo, needsFullRoleAssignment } = assignments[index]!;
    const isFlowBoard = board.boardType === BoardType.FLOW;
    const statusV2 = isFlowBoard
      ? TicketStatusV2.TODO
      : (input.statusV2 as TicketStatusV2) || TicketStatusV2.TODO;
    const priority = (input.priority?.toUpperCase() as TicketPriority) || TicketPriority.MEDIUM;
    const ticketType =
      isFlowBoard && !subTicketIndices.has(index)
        ? BaseTicketType.Epic
        : (input.ticketType ?? null);

    // The stage visit row is only written when the stage tracks an ETA, but its
    // id must exist before evaluateEta runs — that call reads it as the active
    // visit it is deciding about.
    const tracksStageEta = selectedStage.eta !== null && selectedStage.eta > 0;
    const stageVisitId = tracksStageEta ? randomUUID() : null;
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
      assignedTo,
      createdBy: ctx.createdBy,
      createdAt: now.getTime(),
      eta: eta ? eta.getTime() : null,
      xyneId: formatXyneId(projectCode, sequenceNumber),
      stageName: selectedStage.name,
      ticketType,
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
      statusV2,
      priority,
      ticketType,
      assignedTo,
      needsFullRoleAssignment,
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
      // Shared rows, not batch rows: a merchant may legitimately already exist.
      // This is the only createMany here that can meet an existing row.
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
  });

  // Allocated here, not in prepareRows: the column head has to be read under a
  // lock inside this transaction (see allocateKanbanPositions).
  const kanbanPositions = await allocateKanbanPositions(tx, prepared);

  await tx.ticket.createMany({
    data: prepared.map((r) => ({
      id: r.ticketId,
      title: r.input.title,
      description: r.description,
      createdBy: ctx.createdBy,
      updatedBy: ctx.createdBy,
      assignedTo: r.assignedTo,
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
      ticketType: r.ticketType,
      kanbanPosition: kanbanPositions.get(r.index)!,
      createdAt: r.stageEnteredAt,
      lastEmailAt: r.stageEnteredAt,
    })),
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
    });
  }

  const hotfixRows = prepared.filter((r) => r.ticketType === BaseTicketType.Hotfix);
  if (hotfixRows.length > 0) {
    await tx.ticketTag.createMany({
      data: hotfixRows.map((r) => ({
        ticketId: r.ticketId,
        workspaceId: r.workspaceId,
        name: 'hotfix',
      })),
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
    .filter((r) => r.ticketType === BaseTicketType.Hotfix)
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
        assignedTo: row.assignedTo,
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

    // Search indexing. Single creation queues this after the ticket and its form
    // fields are committed; bulk has no form fields, so committing is enough.
    vespaQueue
      .addJob({
        schema: ticketSchema,
        jobType: 'feed',
        docId: row.ticketId,
        userId: ctx.createdBy,
        workspaceId: row.workspaceId,
      })
      .catch((error: unknown) => {
        logger.error('[BulkTicketBatch] Failed to queue Vespa job', {
          ticketId: row.ticketId,
          error,
        });
      });

    // The creation message is written through Prisma, not a Zero mutator, so the
    // vespa-injection handler that normally triggers classification never fires.
    void messageClassificationQueue.enqueueForMessage(row.conversationId);

    void userActivityTrackingService.trackTicketCreated(ctx.createdBy, {
      ticketId: row.ticketId,
      title: row.input.title,
      boardId: row.input.boardId,
      channelId: row.input.channelId,
    });

    // Same shape single-ticket creation emits. The counts client dereferences
    // formFieldValues and roleAssignments without guards, so every field has to
    // be present — a just-created ticket simply has nothing in them yet.
    websocketService.broadcastTicketCountsUpdate({
      operation: 'insert',
      ticket: {
        ...makeFallbackCountsSnapshot({
          id: row.ticketId,
          workspaceId: row.workspaceId,
          boardId: row.input.boardId,
          channelId: row.input.channelId,
          projectId: row.input.projectId,
          stageName: row.stageName,
          statusV2: row.statusV2,
          priority: row.priority,
          assignedTo: row.assignedTo,
          createdBy: ctx.createdBy,
          userGroupId: row.input.userGroupId ?? null,
          ticketType: row.ticketType,
          merchantId: row.input.merchantId ?? null,
          eta: row.eta,
          createdAt: row.stageEnteredAt,
        }),
        tags: row.ticketType === BaseTicketType.Hotfix ? ['hotfix'] : [],
        formFieldValues: {},
      },
    });
  }

  // Role-driven assignment needs a committed ticket, so it runs here rather than
  // in prepareRows. Same shape as single creation: assign the roles, then make
  // the primary role holder the ticket's assignee.
  for (const row of prepared.filter((r) => r.needsFullRoleAssignment)) {
    const userGroupId = row.input.userGroupId;
    if (!userGroupId) continue;
    void (async () => {
      try {
        const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
          ticketId: row.ticketId,
          userGroupId,
          boardId: row.input.boardId,
          createdBy: ctx.createdBy,
          projectId: row.input.projectId,
        });
        const primaryUserId = primaryUserIdOf(fullRoles);
        if (!primaryUserId) return;
        const updated = await prisma.ticket.update({
          where: { id: row.ticketId },
          data: { assignedTo: primaryUserId },
        });
        await syncConversationTicketMdFromPrismaTicket(prisma, updated);
      } catch (error) {
        logger.error('[BulkTicketBatch] Full role assignment failed', {
          ticketId: row.ticketId,
          error,
        });
      }
    })();
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
    subTicketId: randomUUID(),
    mappingId: randomUUID(),
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
      assignedTo: child.assignedTo,
      createdAt: child.stageEnteredAt,
      updatedAt: child.stageEnteredAt,
    })),
  });

  await tx.ticketSubTicketMapping.createMany({
    data: rows.map(({ subTicketId, mappingId }) => ({
      id: mappingId,
      ticketId: parent.id,
      subTicketId,
      workspaceId: parent.workspaceId,
    })),
  });

  // The rest of what subTicketService.createSubTicket does per child: the child's
  // thread needs the parent's anchor card, and the parent's timeline needs a
  // SUBTICKET_CREATED entry. Looped because both are inherently per-child.
  for (const { child, subTicketId } of rows) {
    await linkSubTicketConversationToParent(tx, child.ticketId, parent.id);

    await recordTicketTimelineEvent(
      {
        activity: {
          ticketId: parent.id,
          updatedBy: ctx.createdBy,
          activityType: ActivityType.SUBTICKET_CREATED,
          workspaceId: parent.workspaceId,
          value: {
            subTicketId,
            subTicketTitle: child.input.title,
            subTicketXyneId: child.xyneId,
          },
          timestamp: child.stageEnteredAt,
        },
        ...(parent.conversationId
          ? {
              message: {
                conversationId: parent.conversationId,
                senderId: ctx.createdBy,
                content: `Subticket ${child.xyneId} created: ${child.input.title}`,
                activityType: ActivityType.SUBTICKET_CREATED,
                workspaceId: parent.workspaceId,
                createdAt: child.stageEnteredAt,
              },
            }
          : {}),
      },
      tx as Prisma.TransactionClient
    );
  }
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
 * Not idempotent, and deliberately so: a caller that submits the same batch
 * twice gets two batches, exactly as single-ticket creation does. Because the
 * request either commits whole or writes nothing, retrying a *failed* request
 * is always safe.
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
  // Which rows are sub-tickets: in parent-sub mode everything except a parent
  // this batch is creating itself (that parent sits at index 0).
  const subTicketIndices = new Set<number>(
    request.mode === BulkTicketMode.PARENT_SUB
      ? allRows.map((_, i) => i).filter((i) => !(request.parent && i === 0))
      : []
  );
  // Prepared as one list so the parent and its children share a single sequence
  // reservation and one kanban key chain per column, and so every derived id
  // comes from the same index space.
  const prepared = await prepareRows(allRows, ctx, shared, subTicketIndices);
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

      // SDLC linking: the owner comes from the conversation the batch was raised
      // in, not from the freshly created ones (those can't have a link yet).
      if (ctx.sourceConversationId) {
        const owner = await resolveInheritedOwner(tx, ctx.sourceConversationId);
        if (owner) {
          for (const row of prepared) {
            await linkCreatedEntities(
              tx,
              {
                owner,
                channelId: row.input.channelId,
                conversationId: row.conversationId,
                ticketId: row.ticketId,
              },
              { workspaceId: row.workspaceId, userId: ctx.createdBy }
            );
          }
        }
      }

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
    children: childRows.length,
    createdParent: parentRow !== null,
    parentTicketId: parentLink?.id ?? null,
  });

  // Callers pair results back to their inputs positionally, and `findMany` does
  // not honour the order of an `in` list.
  const created = await prisma.ticket.findMany({
    // workspaceId is redundant with the ACL extension's read scoping and stated
    // anyway: this read decides what goes back to the caller.
    where: { id: { in: childRows.map((r) => r.ticketId) }, workspaceId: ctx.workspaceId },
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
/** Exported for tests. */
export const __testing = { formatXyneId };
