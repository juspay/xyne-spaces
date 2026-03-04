import type {
  NudgeDefinition,
  ActivityEventNudgePayload,
  NudgeEvaluationContext,
  NudgeCandidate,
  ActivityContextOutput,
  NudgeBuildContextRuntime,
} from '../types';
import { EMPTY_ACTIVITY_CONTEXT } from '../types';

export const forwardMessageLink: NudgeDefinition<
  ActivityEventNudgePayload,
  NudgeEvaluationContext
> = {
  kind: 'FORWARD_MESSAGE_LINK',
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
  direction: { from: 'MESSAGE', to: 'MESSAGE' },

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
        sourceType: 'MESSAGE',
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
    const projectId = typeof meta.projectId === 'string' ? meta.projectId : undefined;

    if (!messageId || !originalMessageId) return [];

    return [
      {
        title: 'Forwarded message link',
        description: 'Auto-link from forwarded message',
        actions: {
          actionType: 'CREATE_SURFACE_LINK',
          sourceType: 'MESSAGE',
          sourceId: messageId,
          targetType: 'MESSAGE',
          targetId: originalMessageId,
          linkKind: 'RELATES_TO',
          projectId,
        },
      },
    ];
  },
};
