import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types/express';
import { Prisma } from '@prisma/client';
import {
  buildCallParticipantPreviewUserIdsFromRows,
  type CallParticipantPreviewEntry,
  type CallParticipantPreviewRow,
} from '@/utils/callParticipantCountUtils';

const TAG = '[CallParticipantCountBackfill]';

type BackfillOptions = {
  batchSize: number;
  delayMs: number;
  dryRun: boolean;
  fromTimestamp: Date | null;
  toTimestamp: Date | null;
};

type BackfillSummary = {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
};

type CallParticipantCountRow = {
  id: string;
  updatedAt: Date;
  participantCount: number | null;
  participantPreviewUserIds: unknown;
};

class BackfillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillValidationError';
  }
}

function parseOptionalTimestamp(value: unknown, fieldName: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BackfillValidationError(`${fieldName} must be an ISO 8601 date string`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BackfillValidationError(`${fieldName} must be a valid ISO 8601 date string`);
  }

  return date;
}

function normalizeParticipantPreview(value: unknown): CallParticipantPreviewEntry[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizeParticipantPreviewEntry)
          .filter((entry): entry is CallParticipantPreviewEntry => entry !== null);
      }
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeParticipantPreviewEntry(value: unknown): CallParticipantPreviewEntry | null {
  if (
    value &&
    typeof value === 'object' &&
    'userId' in value &&
    typeof value.userId === 'string'
  ) {
    return {
      userId: value.userId,
      hasJoined: 'hasJoined' in value && value.hasJoined === true,
    };
  }

  return null;
}

export class CallParticipantCountBackfillController {
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static buildOptions(body: unknown): BackfillOptions {
    const payload = (body ?? {}) as Partial<{
      batchSize: number;
      delayMs: number;
      dryRun: boolean;
      fromTimestamp: string;
      toTimestamp: string;
    }>;
    const batchSize = payload.batchSize && payload.batchSize > 0 ? payload.batchSize : 50;
    const delayMs = payload.delayMs && payload.delayMs >= 0 ? payload.delayMs : 1000;
    const dryRun = payload.dryRun === true;
    const fromTimestamp = parseOptionalTimestamp(payload.fromTimestamp, 'fromTimestamp');
    const toTimestamp = parseOptionalTimestamp(payload.toTimestamp, 'toTimestamp');

    if (fromTimestamp && toTimestamp && toTimestamp.getTime() <= fromTimestamp.getTime()) {
      throw new BackfillValidationError('toTimestamp must be after fromTimestamp');
    }

    return { batchSize, delayMs, dryRun, fromTimestamp, toTimestamp };
  }

  private static async runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
    const summary: BackfillSummary = { processed: 0, updated: 0, skipped: 0, errors: 0 };
    let cursor: string | null = null;
    let batchNumber = 0;
    const updatedAtFilter: Prisma.DateTimeFilter = {};
    if (options.fromTimestamp) updatedAtFilter.gte = options.fromTimestamp;
    if (options.toTimestamp) updatedAtFilter.lte = options.toTimestamp;
    const where: Prisma.CallWhereInput = Object.keys(updatedAtFilter).length > 0
      ? { updatedAt: updatedAtFilter }
      : {};

    do {
      batchNumber += 1;
      const calls: CallParticipantCountRow[] = await db.call.findMany({
        where,
        select: { id: true, updatedAt: true, participantCount: true, participantPreviewUserIds: true },
        orderBy: { id: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (calls.length === 0) break;

      logger.info(`${TAG} Selected calls for batch #${batchNumber}`, {
        batchSize: calls.length,
        updatedAtFilter: {
          fromTimestamp: options.fromTimestamp?.toISOString() ?? null,
          toTimestamp: options.toTimestamp?.toISOString() ?? null,
        },
        calls: calls.map(call => ({
          id: call.id,
          updatedAt: call.updatedAt.toISOString(),
        })),
      });

      const callIds = calls.map(call => call.id);
      const counts = await db.callParticipant.groupBy({
        by: ['callId'],
        where: { callId: { in: callIds } },
        _count: { _all: true },
      });
      const countByCallId = new Map(counts.map(row => [row.callId, row._count._all]));
      const participants = await db.callParticipant.findMany({
        where: { callId: { in: callIds } },
        select: {
          id: true,
          callId: true,
          userId: true,
          isExternal: true,
          invitedAt: true,
          respondedAt: true,
          joinedAt: true,
        },
      });
      const participantsByCallId = new Map<string, CallParticipantPreviewRow[]>();
      for (const participant of participants) {
        const callParticipants = participantsByCallId.get(participant.callId) ?? [];
        callParticipants.push(participant);
        participantsByCallId.set(participant.callId, callParticipants);
      }

      for (const call of calls) {
        summary.processed += 1;
        const nextCount = countByCallId.get(call.id) ?? 0;
        const nextPreviewUserIds = buildCallParticipantPreviewUserIdsFromRows(
          participantsByCallId.get(call.id) ?? [],
        );
        const currentPreviewUserIds = normalizeParticipantPreview(call.participantPreviewUserIds);
        const nextPreviewPayload = normalizeParticipantPreview(nextPreviewUserIds);
        const previewUnchanged =
          currentPreviewUserIds.length === nextPreviewPayload.length &&
          currentPreviewUserIds.every(
            (entry, index) =>
              entry.userId === nextPreviewPayload[index]?.userId &&
              entry.hasJoined === nextPreviewPayload[index]?.hasJoined,
          );
        const previewStorageUnchanged = call.participantPreviewUserIds === nextPreviewUserIds;

        if (call.participantCount === nextCount && previewUnchanged && previewStorageUnchanged) {
          summary.skipped += 1;
          continue;
        }

        try {
          if (!options.dryRun) {
            await db.call.update({
              where: { id: call.id },
              data: {
                participantCount: nextCount,
                participantPreviewUserIds: nextPreviewUserIds,
              },
            });
          }
          summary.updated += 1;
        } catch (error) {
          summary.errors += 1;
          logger.warn(`${TAG} Failed to update call`, {
            callId: call.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      cursor = calls[calls.length - 1]?.id ?? null;
      logger.info(`${TAG} Batch #${batchNumber} completed`, {
        batchSize: calls.length,
        ...summary,
      });

      if (options.delayMs > 0) {
        await CallParticipantCountBackfillController.sleep(options.delayMs);
      }
    } while (cursor);

    return summary;
  }

  static async triggerBackfill(req: Request, res: Response<ApiResponse>): Promise<void> {
    try {
      const options = CallParticipantCountBackfillController.buildOptions(req.body);
      logger.info(`${TAG} Starting backfill`, {
        ...options,
        fromTimestamp: options.fromTimestamp?.toISOString() ?? null,
        toTimestamp: options.toTimestamp?.toISOString() ?? null,
      });

      const summary = await CallParticipantCountBackfillController.runBackfill(options);

      logger.info(`${TAG} Backfill completed`, summary);
      res.status(200).json({
        success: true,
        message: options.dryRun ? 'Dry run completed' : 'Backfill completed',
        data: {
          options: {
            ...options,
            fromTimestamp: options.fromTimestamp?.toISOString() ?? null,
            toTimestamp: options.toTimestamp?.toISOString() ?? null,
          },
          summary,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof BackfillValidationError) {
        res.status(400).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      logger.error(`${TAG} Error during backfill:`, error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run call participant count backfill',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
