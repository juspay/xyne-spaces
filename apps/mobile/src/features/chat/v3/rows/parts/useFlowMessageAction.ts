import { useCallback, useEffect, useRef } from 'react';
import type { FlowAction } from '@xyne/shared';

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
} from '@/src/utils/flowAction';
import type { FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';
import type { MessageRowModel } from '../../model/chatRow.types';
import { useRecyclingState } from '../useRecyclingState';
import { flowActionValuesFor } from './flowActionValues';

const HOLD_UNTIL_SYNC_MS = 12_000;

type UseFlowMessageActionResult = {
  activeFlow: FlowDefinitionLike;
  isSubmitting: boolean;
  canPressButtons: boolean;
  executeAction: (action: FlowAction) => Promise<void>;
  updateFieldValue: (name: string, value: unknown) => void;
};

/** v3-native version of v2's flow action hook; target comes from the row model. */
export const useFlowMessageAction = (
  flow: FlowDefinitionLike,
  model: MessageRowModel,
): UseFlowMessageActionResult => {
  const [overrideFlow, setOverrideFlow] = useRecyclingState<FlowDefinitionLike | null>(
    model.conversationId,
    null,
  );
  const [isSubmitting, setIsSubmitting] = useRecyclingState(
    model.conversationId + ':submit',
    false,
  );
  const submittingRef = useRef(false);
  const holdUntilSyncRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isForwarded = model.messageType === 'FORWARDED';
  const target = resolveFlowActionTarget({
    conversationId: model.conversationId,
    fallbackConversationId: model.conversationId,
    isForwarded,
    ...(model.messageId ? { messageId: model.messageId, fallbackMessageId: model.messageId } : {}),
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
  }, [setIsSubmitting]);

  useEffect(
    () => (): void => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    setOverrideFlow(null);
    releaseSubmit();
  }, [flow, releaseSubmit, setOverrideFlow, target.messageId]);

  const updateFieldValue = useCallback(
    (name: string, value: unknown): void => {
      const next = mergeFlowStateValues(activeFlowRef.current, { [name]: value });
      activeFlowRef.current = next;
      setOverrideFlow(next);
    },
    [setOverrideFlow],
  );

  const executeAction = useCallback(
    async (action: FlowAction): Promise<void> => {
      if (isForwarded) return;
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
        return;
      }
      if (!isFlowNetworkAction(action)) return;
      if (!target.canExecute) {
        showMessageToast('Message context not ready yet. Please try again in a moment.', 'error');
        return;
      }

      const currentFlow = activeFlowRef.current;
      const values = flowActionValuesFor(currentFlow);
      if (
        action.type === 'submit' &&
        hasMissingRequiredFlowValues(currentFlow.components, values)
      ) {
        showMessageToast('Please fill in all required fields', 'error');
        return;
      }
      const flowJSON = toValidatedFlowDefinition({
        ...currentFlow,
        state: { ...currentFlow.state, values },
      });
      if (!flowJSON) {
        showMessageToast('This card cannot be submitted.', 'error');
        return;
      }

      const tracksSubmit = action.type === 'submit';
      if (tracksSubmit) {
        if (submittingRef.current) return;
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
          return;
        }
        if (next.flow !== activeFlowRef.current) {
          setOverrideFlow(next.flow);
          return;
        }
        if (response.type === 'close_screen' || response.type === 'ack') {
          holdUntilSyncRef.current = true;
          holdTimerRef.current = setTimeout(releaseSubmit, HOLD_UNTIL_SYNC_MS);
        }
      } catch (error) {
        if (tracksSubmit)
          showMessageToast(action.errorMessage ?? flowActionErrorMessage(error), 'error');
      } finally {
        if (tracksSubmit && !holdUntilSyncRef.current) releaseSubmit();
      }
    },
    [
      isForwarded,
      releaseSubmit,
      setOverrideFlow,
      setIsSubmitting,
      target.canExecute,
      target.conversationId,
      target.messageId,
    ],
  );

  return {
    activeFlow,
    isSubmitting,
    canPressButtons: !isForwarded,
    executeAction,
    updateFieldValue,
  };
};
