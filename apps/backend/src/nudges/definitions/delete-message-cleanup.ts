import type {
  NudgeDefinition,
  ActivityEventNudgePayload,
  NudgeEvaluationContext,
  NudgeCandidate,
  ActivityContextOutput,
  NudgeBuildContextRuntime,
} from '../types';
import { EMPTY_ACTIVITY_CONTEXT } from '../types';
import { NudgeKind, SurfaceAreaType } from '@xyne/shared';

export const deleteMessageCleanup: NudgeDefinition<
  ActivityEventNudgePayload,
  NudgeEvaluationContext
> = {
  kind: NudgeKind.DELETE_MESSAGE_CLEANUP,
  mode: 'implicit',
  trigger: {
    subscribesTo: ['MESSAGE.DELETED'],
    lookbackHandler(event) {
      const meta = event.contextMetadata ?? {};
      return typeof meta.messageId === 'string' && meta.messageId.length > 0;
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
        sourceId: null,
        projectId: null,
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

    return [
      {
        title: 'Delete message cleanup',
        description: 'Clean up surface links and nudges for deleted message',
        actions: {
          actionType: 'DELETE_SURFACE_LINKS',
          sourceType: 'MESSAGE',
          sourceId: messageId,
        },
      },
    ];
  },
};
