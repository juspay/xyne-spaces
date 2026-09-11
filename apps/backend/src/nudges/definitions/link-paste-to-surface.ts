import { db } from '@/database/client';
import { NudgeKind, SurfaceAreaType, SurfaceLinkKind } from '@xyne/shared';
import type {
  NudgeDefinition,
  ActivityEventNudgePayload,
  NudgeEvaluationContext,
  NudgeCandidate,
  ActivityContextOutput,
  NudgeBuildContextRuntime,
} from '../types';
import { EMPTY_ACTIVITY_CONTEXT } from '../types';
import { parseXyneUrlsFromContent } from './helpers';

export const linkPasteToSurface: NudgeDefinition<ActivityEventNudgePayload, NudgeEvaluationContext> =
  {
    kind: NudgeKind.LINK_PASTE_TO_SURFACE,
    mode: 'implicit',
    trigger: {
      subscribesTo: ['MESSAGE.SENT'],
      async lookbackHandler(event) {
        const meta = event.contextMetadata ?? {};
        const messageId = typeof meta.messageId === 'string' ? meta.messageId : undefined;
        if (!messageId) return false;

        // Quick check: does the message content contain any URL-like text?
        const message = await db.message.findUnique({
          where: { messageId },
          select: { content: true },
        });

        if (!message?.content) return false;
        return /https?:\/\//.test(message.content);
      },
    },
    direction: { from: SurfaceAreaType.MESSAGE, to: SurfaceAreaType.MESSAGE },

    async buildContext(
      _payload: ActivityEventNudgePayload,
      _activityContext: ActivityContextOutput,
      runtime: NudgeBuildContextRuntime,
    ): Promise<NudgeEvaluationContext> {
      return {
        triggerEvent: runtime.event,
        enrichedActivity: runtime.enrichedActivity,
        source: {
          sourceId: runtime.messagePayload?.messageId ?? null,
          projectId: runtime.messagePayload?.projectId ?? null,
          sourceType: SurfaceAreaType.MESSAGE,
        },
        activityContext: EMPTY_ACTIVITY_CONTEXT,
      };
    },

    async evaluate(
      _context: NudgeEvaluationContext,
      payload: ActivityEventNudgePayload,
    ): Promise<NudgeCandidate[]> {
      const meta = payload.contextMetadata ?? {};
      const messageId = typeof meta.messageId === 'string' ? meta.messageId : undefined;

      if (!messageId) return [];

      const message = await db.message.findUnique({
        where: { messageId },
        select: { content: true },
      });

      if (!message?.content) return [];

      const refs = parseXyneUrlsFromContent(message.content);
      if (refs.length === 0) return [];

      const candidates: NudgeCandidate[] = [];

      for (const ref of refs) {
        // Validate that the target entity actually exists
        const exists = await entityExists(ref.targetType, ref.targetId);
        if (!exists) continue;

        candidates.push({
          title: `Link to ${ref.targetType.toLowerCase()}`,
          description: `Auto-link from shared URL`,
          actions: {
            actionType: 'CREATE_SURFACE_LINK',
            sourceType: SurfaceAreaType.MESSAGE,
            sourceId: messageId,
            targetType: ref.targetType,
            targetId: ref.targetId,
            linkKind: SurfaceLinkKind.RELATES_TO,
          },
        });
      }

      return candidates;
    },
  };

async function entityExists(targetType: string, targetId: string): Promise<boolean> {
  try {
    switch (targetType) {
      case 'TICKET':
        return !!(await db.ticket.findUnique({ where: { id: targetId }, select: { id: true } }));
      case 'CANVAS':
        return !!(await db.canvas.findUnique({ where: { id: targetId }, select: { id: true } }));
      case 'MESSAGE':
        return !!(await db.message.findUnique({
          where: { messageId: targetId },
          select: { messageId: true },
        }));
      default:
        return false;
    }
  } catch {
    return false;
  }
}
