import { logger } from '@/utils/logger';
import { vespaService } from '@/services/vespaSearch';
import type {
  NudgeDefinition,
  MessageNudgePayload,
  MessageNudgeEvaluationContext,
  NudgeCandidate,
} from '../types';
import type { VespaChatMessageDocument } from '@/vespa/src/types';
import { isEligibleMessage, buildMessageNudgeContext } from './helpers';

const RELATED_MESSAGE_CANDIDATE_LIMIT = 5;
const MIN_RELEVANCE_SCORE = 0.3;

export const findRelatedMessageFromMessage: NudgeDefinition<
  MessageNudgePayload,
  MessageNudgeEvaluationContext
> = {
  kind: 'FIND_RELATED_MESSAGE_FROM_MESSAGE',
  mode: 'explicit',
  priority: 'low',
  trigger: {
    subscribesTo: ['MESSAGE.SENT'],
    async lookbackHandler(event) {
      const meta = event.contextMetadata ?? {};
      const messageId = typeof meta.messageId === 'string' ? meta.messageId : undefined;
      const channelId = typeof meta.channelId === 'string' ? meta.channelId : undefined;
      const conversationId = typeof meta.conversationId === 'string' ? meta.conversationId : undefined;
      if (!messageId || !channelId || !conversationId) return false;
      return isEligibleMessage({ messageId, channelId, conversationId });
    },
  },
  direction: { from: 'MESSAGE', to: 'MESSAGE' },

  async buildContext(payload, activityContext, runtime) {
    return buildMessageNudgeContext(payload, activityContext, runtime);
  },

  async evaluate(
    context: MessageNudgeEvaluationContext,
    _payload: MessageNudgePayload,
  ): Promise<NudgeCandidate[]> {
    // Build search query from message text
    const searchQuery = context.message.messageText.slice(0, 1000);

    // Use activity context signals to prioritize channels
    const activeConversationIds = context.activityContext.signals.activeConversationIds;

    try {
      const results = await vespaService.searchService.searchVespa(
        searchQuery,
        context.message.senderId,
        ['chat'],
        {
          offset: 0,
          limit: RELATED_MESSAGE_CANDIDATE_LIMIT,
          slack: {},
        },
      );

      const hits = (results.root.children || []) as Array<{
        fields: VespaChatMessageDocument;
        relevance: number;
      }>;

      // Filter out the source message itself and messages from the same conversation
      const candidates = hits
        .filter((hit) => {
          const doc = hit.fields;
          if (!doc || doc.docType !== 'message') return false;
          if (doc.docId === context.message.messageId) return false;
          // Exclude messages from the same conversation
          if (doc.threadId === context.message.conversationId) return false;
          return true;
        })
        .filter((hit) => hit.relevance >= MIN_RELEVANCE_SCORE)
        .map((hit) => {
          const doc = hit.fields;
          const text = (doc.text ?? '').slice(0, 200);
          const isInActiveConversation = activeConversationIds.includes(doc.threadId);

          return {
            messageId: doc.docId,
            conversationId: doc.threadId,
            channelId: doc.channelRef,
            text,
            relevance: hit.relevance,
            isInActiveConversation,
          };
        });

      // Sort: prioritize messages in active conversations, then by relevance
      candidates.sort((a, b) => {
        if (a.isInActiveConversation !== b.isInActiveConversation) {
          return a.isInActiveConversation ? -1 : 1;
        }
        return b.relevance - a.relevance;
      });

      const topCandidate = candidates[0];
      if (!topCandidate) return [];

      return [
        {
          title: `Related conversation found`,
          description: topCandidate.text || 'A related discussion was found in another thread.',
          actions: {
            actionType: 'OPEN_RELATED_MESSAGE',
            entityId: topCandidate.messageId,
            evidence: `Relevance: ${(topCandidate.relevance * 100).toFixed(0)}%`,
            conversationId: topCandidate.conversationId,
            channelId: topCandidate.channelId,
          },
        },
      ];
    } catch (error) {
      logger.warn('[FindRelatedMessage] Vespa search failed', {
        messageId: context.message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  },

  async postProcess(
    candidates: NudgeCandidate[],
    _payload: MessageNudgePayload,
  ): Promise<NudgeCandidate[]> {
    return candidates.filter((c) => {
      const actions = c.actions as Record<string, unknown> | undefined;
      return actions?.entityId;
    });
  },
};
