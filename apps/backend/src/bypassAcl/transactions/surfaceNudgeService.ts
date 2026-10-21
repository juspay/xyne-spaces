import { transaction } from '../base';
import { db } from '@/database/client';
import { rebuildSurfaceNudgeAudienceCounts } from '@/nudges/services/surfaceNudgeAudienceCountService';
import type { Prisma } from '@prisma/client';
import type { NudgeCandidate } from '@/nudges/types';
import { SurfaceAreaType, NudgeState, NudgeKind } from '@xyne/shared';


export function dismissNudgesForSourceTx(sourceId: string, sourceType: SurfaceAreaType) {
  return transaction(['Call', 'Canvas', 'Channel', 'Conversation', 'Message', 'SurfaceNudge', 'SurfaceNudgeCount', 'Ticket'], 'dismissNudgesForSource: nudge dismissal plus audience count rebuild must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
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
}
export function persistCandidatesTx(candidates: NudgeCandidate[], nudgeKind: NudgeKind, sourceId: string, workspaceId: string, priority: string | undefined, sourceType: SurfaceAreaType) {
  return transaction(['Call', 'Canvas', 'Channel', 'Conversation', 'Message', 'SurfaceNudge', 'SurfaceNudgeCount', 'Ticket'], 'persistCandidates: candidate nudge inserts plus audience count rebuild must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
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
}
