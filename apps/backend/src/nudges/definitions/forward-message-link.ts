import type {
  NudgeDefinition,
  ActivityEventNudgePayload,
  NudgeEvaluationContext,
  NudgeCandidate,
  ActivityContextOutput,
  NudgeBuildContextRuntime,
} from '../types';
import { EMPTY_ACTIVITY_CONTEXT } from '../types';
import { NudgeKind, SurfaceAreaType, SurfaceLinkKind } from '@xyne/shared';

export const forwardMessageLink: NudgeDefinition<
  ActivityEventNudgePayload,
  NudgeEvaluationContext
> = {
  kind: NudgeKind.FORWARD_MESSAGE_LINK,
  mode: 'implicit',
  trigger: {
    subscribesTo: ['MESSAGE.FORWARDED'],
    lookbackHandler(event) {
      const meta = event.contextMetadata ?? {};
      const messageId = typeof meta.messageId === 'string' ? meta.messageId : undefined;
      const originalMessageId =
        typeof meta.originalMessageId === 'string' ? meta.originalMessageId : undefined;
      return !!(messageId && originalMessageId);
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
    const originalMessageId =
      typeof meta.originalMessageId === 'string' ? meta.originalMessageId : undefined;

    if (!messageId || !originalMessageId) return [];

    return [
      {
        title: 'Forwarded message link',
        description: 'Auto-link from forwarded message',
        actions: {
          actionType: 'CREATE_SURFACE_LINK',
          sourceType: SurfaceAreaType.MESSAGE,
          sourceId: messageId,
          targetType: 'MESSAGE',
          targetId: originalMessageId,
          linkKind: SurfaceLinkKind.RELATES_TO,
        },
      },
    ];
  },
};
