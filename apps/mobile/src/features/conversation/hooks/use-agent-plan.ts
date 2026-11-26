import { useMemo } from 'react';
import { parseInitialMessageMd } from '@xyne/shared';

import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';
import type { useInitialMessageFacts } from '@/src/features/chat/v2/components/chat/chat-message-list-row';
import { useFlowNormalizationOptions } from '@/src/features/chat/v2/components/conversation-composer/utils/useFlowNormalizationOptions';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';

import {
  agentPlanComponent,
  agentPlanFrom,
  isClassicFlowContent,
  type AgentPlan,
} from '../model/agent-plan';
import { isContinuationRow, type ContinuationOptions } from '../model/grouping';

type MessageFacts = ReturnType<typeof useInitialMessageFacts>;

type RowFlow = {
  /** The lone agent plan `FlatMessage` draws as its card; null for any other message. */
  plan: AgentPlan | null;
  /**
   * A flow card the flat layout leaves to the classic row: a flow message that
   * is not a lone agent plan. The row-policy callers pass it as `isFlowJson`.
   */
  isClassicFlow: boolean;
};

/**
 * What a row's flow content means for the flat layout, from the facts the row
 * already parsed. Only a flow message is scanned for a plan, so plain text
 * costs nothing here; the row hands `plan` down so `FlatMessage` never parses.
 */
export function useRowFlow({ initialMessageSummary, isFlowJsonMessage }: MessageFacts): RowFlow {
  const options = useFlowNormalizationOptions();
  const content = initialMessageSummary?.content;
  const component = useMemo(
    () => (isFlowJsonMessage ? agentPlanComponent(content) : null),
    [content, isFlowJsonMessage],
  );
  const plan = useMemo(
    () => (component ? agentPlanFrom(component, options) : null),
    [component, options],
  );
  return { plan, isClassicFlow: isFlowJsonMessage && component === null };
}

/**
 * Whether `paint` joins the block `previousPaint` ends (see `isContinuationRow`).
 * The row above is parsed for a classic flow card only when it could otherwise
 * be joined, the one case its content decides; a flow card can only close a
 * block, so the check without it is the gate.
 */
export function useIsContinuation(
  previousPaint: ChatPaintRow | undefined,
  previousConversation: ConversationItem | undefined,
  paint: ChatPaintRow,
  options: Omit<ContinuationOptions, 'previousIsFlowJson'>,
): boolean {
  const couldJoin = isContinuationRow(previousPaint, paint, options);
  const previousMd = couldJoin ? previousConversation?.initial_message_md : undefined;
  const previousIsClassicFlow = useMemo(
    () => (previousMd ? isClassicFlowContent(parseInitialMessageMd(previousMd)?.content) : false),
    [previousMd],
  );
  return couldJoin && !previousIsClassicFlow;
}
