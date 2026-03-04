import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import type { Prisma, NudgeKind } from '@prisma/client';
import type { NudgeCandidate } from '../types';

interface PersistCandidatesInput {
  sourceId: string;
  nudgeKind: NudgeKind;
  projectId: string;
  candidates: NudgeCandidate[];
  priority?: string; // definition-level default
}

class NudgeService {
  async dismissNudgesForSource(sourceId: string): Promise<void> {
    try {
      await db.$transaction(async (tx) => {
        await tx.surfaceNudge.updateMany({
          where: { sourceId, state: 'ACTIVE' },
          data: { state: 'DISMISSED' },
        });

        const message = await tx.message.findUnique({
          where: { messageId: sourceId },
        });

        if (message) {
          await tx.message.update({
            where: { messageId: sourceId },
            data: { nudgeCount: 0 },
          });
        }
      });

      logger.info('[NudgeService] Dismissed nudges for source', { sourceId });
    } catch (error) {
      logger.error('[NudgeService] Failed to dismiss nudges for source', {
        sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async persistCandidates(input: PersistCandidatesInput): Promise<void> {
    const { sourceId, nudgeKind, projectId, candidates, priority } = input;

    if (candidates.length === 0) return;

    try {
      await db.$transaction(async (tx) => {
        for (const candidate of candidates) {
          await tx.surfaceNudge.create({
            data: {
              nudgeKind,
              sourceId,
              title: candidate.title,
              description: candidate.description,
              priority: candidate.priority ?? priority ?? 'medium',
              actions: (candidate.actions as Prisma.InputJsonValue) ?? undefined,
              state: 'ACTIVE',
              projectId,
              visibleTo: candidate.visibleTo ?? null,
            },
          });
        }

        // Update message nudgeCount if source is a message
        const activeCount = await tx.surfaceNudge.count({
          where: {
            sourceId,
            state: 'ACTIVE',
          },
        });

        const message = await tx.message.findUnique({
          where: { messageId: sourceId },
        });

        if (message) {
          await tx.message.update({
            where: { messageId: sourceId },
            data: { nudgeCount: activeCount },
          });
        }
      });

      logger.info('[NudgeService] Persisted nudge candidates', {
        sourceId,
        nudgeKind,
        count: candidates.length,
      });
    } catch (error) {
      logger.error('[NudgeService] Failed to persist nudge candidates', {
        sourceId,
        nudgeKind,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const nudgeService = new NudgeService();
