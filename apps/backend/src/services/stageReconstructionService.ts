import { Prisma, PrismaClient } from '@prisma/client';
import { ActivityType, ExternalEntityType, MessageType, TicketStatusV2 } from '@xyne/shared';
import { randomUUID } from 'crypto';
import { DatabaseClient } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { logger } from '@/utils/logger';
import { syncStageOverdueFlag } from '@/services/tickets/syncStageOverdueFlag';

type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

type DbClient = PrismaClient | PrismaTransaction;

export type StageReconstructionConfidence = 'high' | 'medium' | 'low' | 'manual_review';

export interface StageReconstructionInput {
  channelId: string;
  dryRun?: boolean;
  ticketIds?: string[];
  actorUserId: string;
}

export interface StageReconstructionChange {
  ticketId: string;
  xyneId: string;
  currentStageName: string;
  reconstructedStageName: string;
  currentStatusV2: TicketStatusV2;
  reconstructedStatusV2: TicketStatusV2;
  lastActivityTimestamp: string | null;
  confidence: StageReconstructionConfidence;
  reason?: string;
  applied: boolean;
  error?: string;
}

export interface StageReconstructionResult {
  runId: string;
  dryRun: boolean;
  totalTickets: number;
  ignoredTicketIds: string[];
  needsReconstruction: number;
  alreadyCorrect: number;
  cannotDetermine: number;
  failedApplications: number;
  changes: StageReconstructionChange[];
}

interface TicketSnapshot {
  id: string;
  xyneId: string;
  workspaceId: string;
  stageName: string;
  statusV2: TicketStatusV2;
  boardId: string;
  conversationId: string;
}

interface StageSnapshot {
  id: string;
  name: string;
  boardId: string;
  sequenceNumber: number;
  defaultTicketStatusV2: TicketStatusV2;
}

interface ActivitySnapshot {
  id: string;
  ticketId: string;
  timestamp: Date;
  activityType: ActivityType;
  value: Prisma.JsonValue;
}

interface MessageSnapshot {
  messageId: string;
  conversationId: string;
  createdAt: Date;
  content: string;
  metadata: Prisma.JsonValue;
}

interface ActiveStageEtaSnapshot {
  ticketId: string;
  stageEnteredAt: Date;
  stage: StageSnapshot;
}

interface ReconstructedState {
  stageName: string;
  boardId: string;
  lastActivityTimestamp: Date | null;
  confidence: StageReconstructionConfidence;
  reason?: string;
}

type ReconstructionEvent =
  | {
      id: string;
      kind: 'stage';
      stageName: string;
      timestamp: Date;
      source: 'activity' | 'message';
    }
  | {
      id: string;
      kind: 'board';
      boardId: string;
      timestamp: Date;
      source: 'activity';
    };

export type StageReconstructionStreamEvent =
  | { type: 'start'; runId: string; dryRun: boolean; totalTickets: number; ignoredTicketIds: string[] }
  | { type: 'batch'; batchIndex: number; changes: StageReconstructionChange[]; progress: { needsReconstruction: number; alreadyCorrect: number; cannotDetermine: number; failedApplications: number } }
  | { type: 'complete'; summary: Omit<StageReconstructionResult, 'changes'> };

const BATCH_SIZE = 10;

export class StageReconstructionService {
  constructor(
    private readonly db: DbClient = DatabaseClient.getInstance(),
  ) {}

  async *reconstruct(input: StageReconstructionInput): AsyncGenerator<StageReconstructionStreamEvent> {
    const dryRun = input.dryRun ?? true;
    const runId = randomUUID();
    const cutoff = await this.resolveCutoff(input);

    const tickets = await this.db.ticket.findMany({
      where: {
        channelId: input.channelId,
        ...(input.ticketIds?.length ? { id: { in: input.ticketIds } } : {}),
      },
      select: {
        id: true,
        xyneId: true,
        workspaceId: true,
        stageName: true,
        statusV2: true,
        boardId: true,
        conversationId: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const ignoredTicketIds = this.getIgnoredTicketIds(input.ticketIds, tickets as TicketSnapshot[]);

    yield { type: 'start', runId, dryRun, totalTickets: tickets.length, ignoredTicketIds };

    const totals = {
      needsReconstruction: 0,
      alreadyCorrect: 0,
      cannotDetermine: 0,
      failedApplications: 0,
    };

    if (!cutoff) {
      const changes = tickets.map((ticket) => this.manualReviewChange(ticket as TicketSnapshot, 'migration cutoff could not be determined'));
      totals.cannotDetermine = tickets.length;
      yield { type: 'batch', batchIndex: 0, changes, progress: { ...totals } };
    } else {
      let batchIndex = 0;
      for (let offset = 0; offset < tickets.length; offset += BATCH_SIZE) {
        const batch = tickets.slice(offset, offset + BATCH_SIZE);
        const batchResult = await this.processBatch(batch as TicketSnapshot[], cutoff, dryRun, input.actorUserId);

        totals.needsReconstruction += batchResult.needsReconstruction;
        totals.alreadyCorrect += batchResult.alreadyCorrect;
        totals.cannotDetermine += batchResult.cannotDetermine;
        totals.failedApplications += batchResult.failedApplications;

        yield { type: 'batch', batchIndex, changes: batchResult.changes, progress: { ...totals } };
        batchIndex += 1;
      }
    }

    const summary: Omit<StageReconstructionResult, 'changes'> = {
      runId,
      dryRun,
      totalTickets: tickets.length,
      ignoredTicketIds,
      ...totals,
    };

    this.logResult(input, summary);
    yield { type: 'complete', summary };
  }

  private getIgnoredTicketIds(requestedTicketIds: string[] | undefined, tickets: TicketSnapshot[]): string[] {
    if (!requestedTicketIds?.length) {
      return [];
    }

    const processedTicketIds = new Set(tickets.map((ticket) => ticket.id));
    const uniqueRequestedIds = new Set(requestedTicketIds);
    return [...uniqueRequestedIds].filter((ticketId) => !processedTicketIds.has(ticketId));
  }

  private async resolveCutoff(input: StageReconstructionInput): Promise<Date | null> {
    const earliestTicket = await this.db.ticket.findFirst({
      where: { channelId: input.channelId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    if (!earliestTicket) return null;

    const channelTicketIds = await this.db.ticket.findMany({
      where: { channelId: input.channelId },
      select: { id: true },
    });

    const ids = channelTicketIds.map((ticket) => ticket.id);

    const migratedTicket = await this.db.externalMessage.findFirst({
      where: {
        entityType: ExternalEntityType.TICKET,
        entityId: { in: ids },
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    return migratedTicket?.createdAt ?? earliestTicket.createdAt;
  }

  private async processBatch(
    tickets: TicketSnapshot[],
    cutoff: Date,
    dryRun: boolean,
    actorUserId: string,
  ): Promise<Pick<StageReconstructionResult, 'needsReconstruction' | 'alreadyCorrect' | 'cannotDetermine' | 'failedApplications' | 'changes'>> {
    const ticketIds = tickets.map((ticket) => ticket.id);
    const conversationIds = tickets.map((ticket) => ticket.conversationId);
    const boardIds = [...new Set(tickets.map((ticket) => ticket.boardId))];

    const [activities, messages, stages, activeStageEtas] = await Promise.all([
      this.db.ticketActivity.findMany({
        where: {
          ticketId: { in: ticketIds },
          timestamp: { gt: cutoff },
          activityType: { in: [ActivityType.STATUS, ActivityType.STAGE_NAME, ActivityType.BOARD] },
        },
        select: {
          id: true,
          ticketId: true,
          timestamp: true,
          activityType: true,
          value: true,
        },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      }),
      withWorkspaceScope(() => this.db.message.findMany({
        where: {
          conversationId: { in: conversationIds },
          msgType: MessageType.SYSTEM,
          createdAt: { gt: cutoff },
        },
        select: {
          messageId: true,
          conversationId: true,
          createdAt: true,
          content: true,
          metadata: true,
        },
        orderBy: [{ createdAt: 'asc' }, { messageId: 'asc' }],
      })),
      this.db.stage.findMany({
        where: { boardId: { in: boardIds } },
        select: {
          id: true,
          name: true,
          boardId: true,
          sequenceNumber: true,
          defaultTicketStatusV2: true,
        },
        orderBy: [{ boardId: 'asc' }, { sequenceNumber: 'asc' }],
      }),
      this.db.ticketStageEta.findMany({
        where: {
          ticketId: { in: ticketIds },
          stageLeftAt: null,
        },
        select: {
          ticketId: true,
          stageEnteredAt: true,
          stage: {
            select: {
              id: true,
              name: true,
              boardId: true,
              sequenceNumber: true,
              defaultTicketStatusV2: true,
            },
          },
        },
        orderBy: [{ stageEnteredAt: 'desc' }, { id: 'asc' }],
      }),
    ]);

    const activitiesByTicket = this.groupBy(activities, (activity) => activity.ticketId);
    const messagesByConversation = this.groupBy(messages, (message) => message.conversationId);
    const stagesByBoard = this.groupBy(stages as StageSnapshot[], (stage) => stage.boardId);
    const activeStageEtaByTicket = new Map<string, ActiveStageEtaSnapshot>();
    for (const entry of activeStageEtas) {
      if (!activeStageEtaByTicket.has(entry.ticketId)) {
        activeStageEtaByTicket.set(entry.ticketId, entry as ActiveStageEtaSnapshot);
      }
    }

    const batchResult = {
      needsReconstruction: 0,
      alreadyCorrect: 0,
      cannotDetermine: 0,
      failedApplications: 0,
      changes: [] as StageReconstructionChange[],
    };

    interface PendingApply {
      ticket: TicketSnapshot;
      stageName: string;
      statusV2: TicketStatusV2;
      change: StageReconstructionChange;
    }

    const pendingApplies: PendingApply[] = [];

    for (const ticket of tickets) {
      const reconstructed = this.reconstructTicket(
        ticket,
        (activitiesByTicket.get(ticket.id) ?? []) as ActivitySnapshot[],
        messagesByConversation.get(ticket.conversationId) ?? [],
        stagesByBoard,
        activeStageEtaByTicket.get(ticket.id),
      );

      if (!reconstructed) {
        batchResult.alreadyCorrect += 1;
        continue;
      }

      if (reconstructed.confidence === 'manual_review') {
        batchResult.cannotDetermine += 1;
        batchResult.changes.push(this.changeFromState(ticket, reconstructed, ticket.statusV2, false));
        continue;
      }

      const matchedStage = (stagesByBoard.get(ticket.boardId) ?? []).find(
        (stage) => stage.name === reconstructed.stageName,
      );

      if (!matchedStage) {
        batchResult.cannotDetermine += 1;
        batchResult.changes.push(
          this.changeFromState(ticket, {
            ...reconstructed,
            confidence: 'manual_review',
            reason: `stage "${reconstructed.stageName}" was not found on current board`,
          }, ticket.statusV2, false),
        );
        continue;
      }

      const reconstructedStatusV2 = matchedStage.defaultTicketStatusV2;
      if (ticket.stageName === reconstructed.stageName && ticket.statusV2 === reconstructedStatusV2) {
        batchResult.alreadyCorrect += 1;
        continue;
      }

      batchResult.needsReconstruction += 1;
      const change = this.changeFromState(ticket, reconstructed, reconstructedStatusV2 as TicketStatusV2, false);

      if (dryRun) {
        batchResult.changes.push(change);
      } else {
        pendingApplies.push({ ticket, stageName: reconstructed.stageName, statusV2: reconstructedStatusV2 as TicketStatusV2, change });
      }
    }

    if (pendingApplies.length > 0) {
      await Promise.allSettled(
        pendingApplies.map(({ ticket, stageName, statusV2, change }) =>
          this.applyReconstructedState(ticket, stageName, statusV2, actorUserId)
            .then(() => { change.applied = true; })
            .catch((error) => {
              batchResult.failedApplications += 1;
              change.error = error instanceof Error ? error.message : 'Failed to apply reconstructed state';
              logger.error('[StageReconstruction] Failed to apply reconstructed state', error, {
                ticketId: ticket.id,
                xyneId: ticket.xyneId,
                reconstructedStageName: stageName,
                reconstructedStatusV2: statusV2,
              });
            }),
        ),
      );
      for (const { change } of pendingApplies) {
        batchResult.changes.push(change);
      }
    }

    return batchResult;
  }

  private async applyReconstructedState(
    ticket: TicketSnapshot,
    reconstructedStageName: string,
    reconstructedStatusV2: TicketStatusV2,
    actorUserId: string,
  ): Promise<void> {
    await this.runInTransaction(async (tx) => {
      const now = new Date();
      const stageChanged = ticket.stageName !== reconstructedStageName;
      const statusChanged = ticket.statusV2 !== reconstructedStatusV2;

      const updatedTicket = await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          stageName: reconstructedStageName,
          statusV2: reconstructedStatusV2,
          ...(statusChanged ? { statusUpdatedAt: now } : {}),
          updatedBy: actorUserId,
          updatedAt: now,
        },
      });

      await syncConversationTicketMdFromPrismaTicket(tx, updatedTicket);

      if (stageChanged) {
        const targetStage = await tx.stage.findFirst({
          where: { boardId: ticket.boardId, name: reconstructedStageName },
          select: { id: true, eta: true },
        });

        if (targetStage) {
          await tx.ticketStageEta.updateMany({
            where: {
              ticketId: ticket.id,
              stageLeftAt: null,
            },
            data: {
              stageLeftAt: now,
              updatedAt: now,
              updatedBy: actorUserId,
            },
          });

          const existingEntry = await tx.ticketStageEta.findFirst({
            where: { ticketId: ticket.id, stageId: targetStage.id },
          });

          if (existingEntry && targetStage.eta !== null && targetStage.eta > 0) {
            await tx.ticketStageEta.update({
              where: { id: existingEntry.id },
              data: {
                stageEnteredAt: now,
                stageLeftAt: null,
                stageEta: calculateETADeadline(now, targetStage.eta),
                updatedAt: now,
                updatedBy: actorUserId,
              },
            });
          } else if (!existingEntry && targetStage.eta !== null && targetStage.eta > 0) {
            await tx.ticketStageEta.create({
              data: {
                workspaceId: ticket.workspaceId,
                ticketId: ticket.id,
                stageId: targetStage.id,
                stageEnteredAt: now,
                stageLeftAt: null,
                stageEta: calculateETADeadline(now, targetStage.eta),
                updatedBy: actorUserId,
              },
            });
          }
        }

        await syncStageOverdueFlag(tx, ticket.id, now);

        await tx.ticketActivity.create({
          data: {
            workspaceId: ticket.workspaceId,
            ticketId: ticket.id,
            updatedBy: actorUserId,
            timestamp: now,
            activityType: ActivityType.STAGE_NAME,
            value: {
              field: 'stageName',
              oldValue: ticket.stageName,
              newValue: reconstructedStageName,
              source: 'STAGE_RECONSTRUCTION',
            } as Prisma.InputJsonValue,
          },
        });
      }

      if (statusChanged) {
        await tx.ticketActivity.create({
          data: {
            workspaceId: ticket.workspaceId,
            ticketId: ticket.id,
            updatedBy: actorUserId,
            timestamp: now,
            activityType: ActivityType.STATUS,
            value: {
              field: 'statusV2',
              oldValue: ticket.statusV2,
              newValue: reconstructedStatusV2,
              source: 'STAGE_RECONSTRUCTION',
            } as Prisma.InputJsonValue,
          },
        });
      }
    });
  }

  private async runInTransaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T> {
    const maybePrismaClient = this.db as PrismaClient;
    if (typeof maybePrismaClient.$transaction === 'function') {
      return maybePrismaClient.$transaction(fn);
    }

    return fn(this.db as PrismaTransaction);
  }

  private reconstructTicket(
    ticket: TicketSnapshot,
    activities: ActivitySnapshot[],
    messages: MessageSnapshot[],
    stagesByBoard: Map<string, StageSnapshot[]>,
    activeStageEta?: ActiveStageEtaSnapshot,
  ): ReconstructedState | null {
    const events = [
      ...activities.flatMap((activity) => this.activityToEvent(activity)),
      ...messages.flatMap((message) => this.messageToEvent(ticket.id, message)),
    ].sort((left, right) => {
      const diff = left.timestamp.getTime() - right.timestamp.getTime();
      return diff !== 0 ? diff : left.id.localeCompare(right.id);
    });

    if (events.length === 0 && activeStageEta) {
      if (activeStageEta.stage.boardId !== ticket.boardId) {
        return {
          stageName: ticket.stageName,
          boardId: activeStageEta.stage.boardId,
          lastActivityTimestamp: activeStageEta.stageEnteredAt,
          confidence: 'manual_review',
          reason: 'active TicketStageEta entry belongs to a different board',
        };
      }

      return {
        stageName: activeStageEta.stage.name,
        boardId: activeStageEta.stage.boardId,
        lastActivityTimestamp: activeStageEta.stageEnteredAt,
        confidence: 'low',
        reason: 'derived from active TicketStageEta entry because no post-cutoff stage activity was found',
      };
    }

    if (events.length === 0) {
      return null;
    }

    let state: ReconstructedState | null = null;

    const stageTimestamps = new Set(
      events.filter((e) => e.kind === 'stage').map((e) => e.timestamp.getTime()),
    );

    for (const event of events) {
      if (event.kind === 'stage') {
        state = {
          stageName: event.stageName,
          boardId: ticket.boardId,
          lastActivityTimestamp: event.timestamp,
          confidence: event.source === 'activity' ? 'high' : 'medium',
        };
      } else {
        if (event.boardId !== ticket.boardId) {
          state = {
            stageName: ticket.stageName,
            boardId: event.boardId,
            lastActivityTimestamp: event.timestamp,
            confidence: 'manual_review',
            reason: 'activity history shows a board change, but this endpoint only repairs stages',
          };
          continue;
        }

        if (stageTimestamps.has(event.timestamp.getTime())) {
          continue;
        }

        const firstStage = stagesByBoard.get(event.boardId)?.[0];
        if (!firstStage) {
          state = {
            stageName: ticket.stageName,
            boardId: event.boardId,
            lastActivityTimestamp: event.timestamp,
            confidence: 'manual_review',
            reason: `no stages found for board ${event.boardId}`,
          };
          continue;
        }

        state = {
          stageName: firstStage.name,
          boardId: event.boardId,
          lastActivityTimestamp: event.timestamp,
          confidence: 'high',
        };
      }
    }

    return state;
  }

  private activityToEvent(activity: ActivitySnapshot): ReconstructionEvent[] {
    const value = this.asRecord(activity.value);
    if (!value) return [];

    if (
      (activity.activityType === ActivityType.STATUS || activity.activityType === ActivityType.STAGE_NAME) &&
      value['field'] === 'stageName' &&
      typeof value['newValue'] === 'string'
    ) {
      return [{
        id: activity.id,
        kind: 'stage',
        stageName: value['newValue'],
        timestamp: activity.timestamp,
        source: 'activity',
      }];
    }

    if (activity.activityType === ActivityType.BOARD && typeof value['newValue'] === 'string') {
      return [{
        id: activity.id,
        kind: 'board',
        boardId: value['newValue'],
        timestamp: activity.timestamp,
        source: 'activity',
      }];
    }

    return [];
  }

  private messageToEvent(ticketId: string, message: MessageSnapshot): ReconstructionEvent[] {
    const metadata = this.asRecord(message.metadata);
    if (!metadata || metadata['isTicketActivity'] !== true || metadata['activityType'] !== 'STATUS') {
      return [];
    }

    const match = message.content.match(/moved ticket from "(.+)" to "(.+)"/);
    if (!match?.[2]) return [];

    return [{
      id: `${ticketId}:${message.messageId}`,
      kind: 'stage',
      stageName: match[2],
      timestamp: message.createdAt,
      source: 'message',
    }];
  }

  private changeFromState(
    ticket: TicketSnapshot,
    reconstructed: ReconstructedState,
    reconstructedStatusV2: TicketStatusV2,
    applied: boolean,
  ): StageReconstructionChange {
    return {
      ticketId: ticket.id,
      xyneId: ticket.xyneId,
      currentStageName: ticket.stageName,
      reconstructedStageName: reconstructed.stageName,
      currentStatusV2: ticket.statusV2,
      reconstructedStatusV2,
      lastActivityTimestamp: reconstructed.lastActivityTimestamp?.toISOString() ?? null,
      confidence: reconstructed.confidence,
      reason: reconstructed.reason,
      applied,
    };
  }

  private manualReviewChange(ticket: TicketSnapshot, reason: string): StageReconstructionChange {
    return {
      ticketId: ticket.id,
      xyneId: ticket.xyneId,
      currentStageName: ticket.stageName,
      reconstructedStageName: ticket.stageName,
      currentStatusV2: ticket.statusV2,
      reconstructedStatusV2: ticket.statusV2,
      lastActivityTimestamp: null,
      confidence: 'manual_review',
      reason,
      applied: false,
    };
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private groupBy<T, K>(items: T[], getKey: (item: T) => K): Map<K, T[]> {
    const grouped = new Map<K, T[]>();
    for (const item of items) {
      const key = getKey(item);
      const existing = grouped.get(key);
      if (existing) {
        existing.push(item);
      } else {
        grouped.set(key, [item]);
      }
    }
    return grouped;
  }

  private logResult(input: StageReconstructionInput, summary: Omit<StageReconstructionResult, 'changes'>): void {
    logger.info('[StageReconstruction] Completed', {
      runId: summary.runId,
      channelId: input.channelId,
      actorUserId: input.actorUserId,
      dryRun: summary.dryRun,
      totalTickets: summary.totalTickets,
      needsReconstruction: summary.needsReconstruction,
      alreadyCorrect: summary.alreadyCorrect,
      cannotDetermine: summary.cannotDetermine,
      failedApplications: summary.failedApplications,
    });
  }
}

export const stageReconstructionService = new StageReconstructionService();
