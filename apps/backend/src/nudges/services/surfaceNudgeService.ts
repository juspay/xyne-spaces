import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import type { Prisma } from '@prisma/client';
import { NudgeKind, SurfaceAreaType, NudgeState } from '@xyne/shared';
import { rebuildSurfaceNudgeAudienceCounts } from './surfaceNudgeAudienceCountService';
import { getNudgeCreatedTotal } from '@/services/otel';
import type { NudgeCandidate } from '../types';

interface PersistCandidatesInput {
  sourceId: string;
  sourceType: SurfaceAreaType;
  nudgeKind: NudgeKind;
  workspaceId: string;
  candidates: NudgeCandidate[];
  priority?: string; // definition-level default
}

class NudgeService {
  async dismissNudgesForSource(sourceId: string, sourceType: SurfaceAreaType): Promise<void> {
    try {
      await db.$transaction(async (tx) => {
        await tx.surfaceNudge.updateMany({
          where: { sourceId, state: { in: [NudgeState.ACTIVE, NudgeState.ACTED_ON] } },
          data: { state: NudgeState.DISMISSED },
        });
        await rebuildSurfaceNudgeAudienceCounts({
          tx,
          sourceId,
          sourceType,
        });
      });

      logger.info('[NudgeService] Dismissed nudges for source', { sourceId, sourceType });
    } catch (error) {
      logger.error('[NudgeService] Failed to dismiss nudges for source', {
        sourceId,
        sourceType,
        error: error,
      });
    }
  }

  async persistCandidates(input: PersistCandidatesInput): Promise<void> {
    const { sourceId, sourceType, nudgeKind, workspaceId, candidates, priority } = input;

    if (candidates.length === 0) return;

    try {
      await db.$transaction(async (tx) => {
        for (const candidate of candidates) {
          await tx.surfaceNudge.create({
            data: {
              nudgeKind,
              sourceId,
              workspaceId,
              title: candidate.title,
              description: candidate.description,
              priority: candidate.priority ?? priority ?? 'medium',
              actions: (candidate.actions as Prisma.InputJsonValue) ?? undefined,
              state: NudgeState.ACTIVE,
              visibleTo: candidate.visibleTo ?? null,
            },
          });
        }
        await rebuildSurfaceNudgeAudienceCounts({
          tx,
          sourceId,
          sourceType,
        });
      });

      try {
        getNudgeCreatedTotal().add(candidates.length, { nudge_kind: nudgeKind });
      } catch (_metricsError) {
        // non-blocking
      }

      logger.info('[NudgeService] Persisted nudge candidates', {
        sourceId,
        sourceType,
        nudgeKind,
        count: candidates.length,
      });
    } catch (error) {
      logger.error('[NudgeService] Failed to persist nudge candidates', {
        sourceId,
        sourceType,
        nudgeKind,
        error: error,
      });
      throw error;
    }
  }
}

export const nudgeService = new NudgeService();
