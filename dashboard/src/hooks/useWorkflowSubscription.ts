import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { websocketService } from '../services/clients/socketClient';

/**
 * Throttle interval for workflow step updates (in milliseconds)
 * Limits refetches to at most once every 2 seconds during rapid updates
 */
const THROTTLE_INTERVAL_MS = 2000;

/**
 * Event data for workflow step added
 */
export interface WorkflowStepAddedEvent {
  executionId: string;
  stepId: string;
  stepName: string | null;
  type: string | null;
  stepExecutorType: string;
  timestamp: string;
}

/**
 * Custom hook to subscribe to real-time workflow step updates via WebSocket
 *
 * Handles automatic subscription when component mounts and cleanup when unmounts.
 * Re-subscribes automatically when executionId changes.
 * Also invalidates step-details queries to ensure StepDetails panel updates.
 *
 * Uses throttling (10s) to prevent excessive refetches during rapid workflow execution.
 * First event triggers immediately, subsequent events within the throttle window
 * are batched with a trailing edge refetch.
 *
 * @param executionId - The workflow execution ID to subscribe to
 * @param onStepAdded - Callback function to be called when a new step is added
 *
 * @example
 * ```typescript
 * // Subscribe to workflow updates and refetch on changes
 * useWorkflowSubscription(executionId, () => {
 *   void refetchCombinedSteps();
 * });
 * ```
 */
export const useWorkflowSubscription = (
  executionId: string | null | undefined,
  onStepAdded: () => void,
): void => {
  const queryClient = useQueryClient();

  // Use ref to avoid recreating the callback on every render
  const onStepAddedRef = useRef(onStepAdded);
  onStepAddedRef.current = onStepAdded;

  // Throttle state refs
  const lastRefetchTimeRef = useRef<number>(0);
  const pendingRefetchRef = useRef<NodeJS.Timeout | null>(null);

  // Perform the actual refetch and query invalidation
  const doRefetch = useCallback(() => {
    onStepAddedRef.current();
    void queryClient.invalidateQueries({
      queryKey: ['step-details'],
      refetchType: 'active',
    });
  }, [queryClient]);

  // Throttled event handler - leading edge + trailing edge throttle
  const handleStepAdded = useCallback(
    (data: WorkflowStepAddedEvent) => {
      // Only trigger callback if the event is for the subscribed execution
      if (data.executionId !== executionId) {
        return;
      }

      const now = Date.now();
      const timeSinceLastRefetch = now - lastRefetchTimeRef.current;

      if (timeSinceLastRefetch >= THROTTLE_INTERVAL_MS) {
        // Throttle window passed - refetch immediately (leading edge)
        doRefetch();
        lastRefetchTimeRef.current = now;

        // Clear any pending trailing refetch since we just refetched
        if (pendingRefetchRef.current) {
          clearTimeout(pendingRefetchRef.current);
          pendingRefetchRef.current = null;
        }
      } else {
        // Within throttle window - schedule trailing edge refetch if not already scheduled
        if (!pendingRefetchRef.current) {
          const remainingTime = THROTTLE_INTERVAL_MS - timeSinceLastRefetch;
          pendingRefetchRef.current = setTimeout(() => {
            doRefetch();
            lastRefetchTimeRef.current = Date.now();
            pendingRefetchRef.current = null;
          }, remainingTime);
        }
        // If already scheduled, do nothing - the pending refetch will handle it
      }
    },
    [executionId, doRefetch],
  );

  useEffect((): (() => void) | undefined => {
    // Guard clause: Don't subscribe if no execution ID
    if (!executionId) {
      return;
    }

    let subscribed = false;
    let retryTimeout: NodeJS.Timeout | null = null;

    // Function to attempt subscription
    const attemptSubscription = (): void => {
      if (!websocketService.isConnectedToServer()) {
        // WebSocket not connected yet, retry after a short delay
        console.log(
          `🔌 [WORKFLOW-SUB] WebSocket not connected, retrying subscription for ${executionId}...`,
        );
        retryTimeout = setTimeout(attemptSubscription, 500);
        return;
      }

      if (subscribed) {
        // Already subscribed, don't subscribe again
        return;
      }

      // Subscribe to the workflow room
      console.log(`📊 [WORKFLOW-SUB] Subscribing to workflow: ${executionId}`);
      websocketService.emit('subscribe_to_workflow', { executionId });
      subscribed = true;
    };

    // Listen for workflow step added events
    websocketService.on<WorkflowStepAddedEvent>('workflow_step_added', handleStepAdded);

    // Start subscription attempt
    attemptSubscription();

    // Cleanup function - runs when:
    // 1. Component unmounts
    // 2. executionId changes (before re-subscribing to new workflow)
    return (): void => {
      // Clear retry timeout if still pending
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }

      if (subscribed && websocketService.isConnectedToServer()) {
        console.log(`📊 [WORKFLOW-UNSUB] Unsubscribing from workflow: ${executionId}`);
        websocketService.emit('unsubscribe_from_workflow', { executionId });
      }

      // Remove the event listener
      websocketService.removeListener('workflow_step_added', handleStepAdded);

      // Clear any pending throttled refetch
      if (pendingRefetchRef.current) {
        clearTimeout(pendingRefetchRef.current);
        pendingRefetchRef.current = null;
      }
    };
  }, [executionId, handleStepAdded]);
};
