import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageType, type FlowAction } from '@xyne/shared';

import { useConversationComposer } from '../conversation-composer-context';
import { executeFlowAction } from '@/src/services/flowActionService';
import { showMessageToast } from '@/src/utils/toast';
import {
  applyClientFlowAction,
  applyFlowActionResponse,
  flowActionErrorMessage,
  hasMissingRequiredFlowValues,
  isFlowNetworkAction,
  mergeFlowStateValues,
  resolveFlowActionTarget,
  toValidatedFlowDefinition,
  withImplicitFlowValues,
} from '@/src/utils/flowAction';
import { sanitizeUserQuestionAnswers } from '@/src/utils/flowUserQuestionUtils';
import type { FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';

const HOLD_UNTIL_SYNC_MS = 12_000;

type UseFlowMessageActionResult = {
  activeFlow: FlowDefinitionLike;
  isSubmitting: boolean;
  canExecute: boolean;
  canPressButtons: boolean;
  executeAction: (action: FlowAction) => Promise<boolean>;
  updateFieldValue: (name: string, value: unknown) => void;
};

export const useFlowMessageAction = (flow: FlowDefinitionLike): UseFlowMessageActionResult => {
  const { summary, item } = useConversationComposer();
  const [overrideFlow, setOverrideFlow] = useState<FlowDefinitionLike | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const holdUntilSyncRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isForwarded = summary?.msgType === MessageType.FORWARDED;
  const target = resolveFlowActionTarget({
    messageId: summary?.messageId,
    conversationId: summary?.conversationId,
    fallbackMessageId: item.initialMessageId,
    fallbackConversationId: item.conversationId,
    isForwarded,
  });
  const activeFlow = overrideFlow ?? flow;
  const activeFlowRef = useRef(activeFlow);
  activeFlowRef.current = activeFlow;

  const releaseSubmit = useCallback((): void => {
    holdUntilSyncRef.current = false;
    submittingRef.current = false;
    setIsSubmitting(false);
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setOverrideFlow(null);
    releaseSubmit();
  }, [flow, releaseSubmit, target.messageId]);

  const updateFieldValue = useCallback((name: string, value: unknown): void => {
    const next = mergeFlowStateValues(activeFlowRef.current, { [name]: value });
    activeFlowRef.current = next;
    setOverrideFlow(next);
  }, []);

  const executeAction = useCallback(
    async (action: FlowAction): Promise<boolean> => {
      if (isForwarded) return false;

      // Dashboard FlowRenderer handles these client-side with no network call.
      if (
        action.type === 'update_state' ||
        action.type === 'close_screen' ||
        action.type === 'navigate'
      ) {
        const next = applyClientFlowAction(activeFlowRef.current, action);
        if (next.flow !== activeFlowRef.current) {
          activeFlowRef.current = next.flow;
          setOverrideFlow(next.flow);
        }
        if (next.toastMessage) showMessageToast(next.toastMessage, 'success');
        return true;
      }

      if (!isFlowNetworkAction(action)) return false;

      if (!target.canExecute) {
        showMessageToast('Message context not ready yet. Please try again in a moment.', 'error');
        return false;
      }

      const currentFlow = activeFlowRef.current;
      const values = withImplicitFlowValues(currentFlow);
      if (values['answers'] !== undefined) {
        values['answers'] = sanitizeUserQuestionAnswers(
          values['answers'] as Record<string, unknown>,
        );
      }
      if (
        action.type === 'submit' &&
        hasMissingRequiredFlowValues(currentFlow.components, values)
      ) {
        showMessageToast('Please fill in all required fields', 'error');
        return false;
      }

      const flowJSON = toValidatedFlowDefinition({
        ...currentFlow,
        state: { ...currentFlow.state, values },
      });
      if (!flowJSON) {
        showMessageToast('This card cannot be submitted.', 'error');
        return false;
      }

      const tracksSubmit = action.type === 'submit';
      if (tracksSubmit) {
        if (submittingRef.current) return false;
        submittingRef.current = true;
        setIsSubmitting(true);
      }

      try {
        const response = await executeFlowAction({
          actionId: action.actionId,
          type: action.type,
          values,
          flowJSON,
          messageId: target.messageId,
          conversationId: target.conversationId,
        });
        const next = applyFlowActionResponse(activeFlowRef.current, response);
        if (next.errorMessage) {
          showMessageToast(next.errorMessage, 'error');
          return false;
        }
        if (next.flow !== activeFlowRef.current) {
          setOverrideFlow(next.flow);
          return true;
        }
        if (response.type === 'close_screen' || response.type === 'ack') {
          if (response.type === 'close_screen' && response.finalMessage) {
            showMessageToast(response.finalMessage, 'success');
          }
          holdUntilSyncRef.current = true;
          holdTimerRef.current = setTimeout(releaseSubmit, HOLD_UNTIL_SYNC_MS);
          return true;
        }
        return true;
      } catch (error) {
        if (tracksSubmit) {
          showMessageToast(action.errorMessage ?? flowActionErrorMessage(error), 'error');
        }
        return false;
      } finally {
        if (tracksSubmit && !holdUntilSyncRef.current) releaseSubmit();
      }
    },
    [isForwarded, releaseSubmit, target.canExecute, target.conversationId, target.messageId],
  );

  return {
    activeFlow,
    isSubmitting,
    canExecute: target.canExecute,
    canPressButtons: !isForwarded,
    executeAction,
    updateFieldValue,
  };
};
