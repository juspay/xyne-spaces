import { useEffect, useCallback, useRef } from 'react';
import { websocketService } from '../services/clients/socketClient';

/**
 * Throttle interval for workspace updates (in milliseconds)
 * Limits refetches to at most once every 500ms during rapid file changes
 */
const THROTTLE_INTERVAL_MS = 500;

/**
 * Workspace event types
 */
export type WorkspaceEventType =
  | 'workspace_ready'
  | 'file_tree_update'
  | 'file_content_update'
  | 'workspace_closed'
  | 'cloning_started';

/**
 * Base workspace event data
 */
export interface BaseWorkspaceEvent {
  type: WorkspaceEventType;
  executionId: string; // parent execution ID
  parentExecutionId: string;
  childExecutionId: string;
  timestamp: string;
}

/**
 * Workspace ready event
 */
export interface WorkspaceReadyEvent extends BaseWorkspaceEvent {
  type: 'workspace_ready';
}

/**
 * File tree update event
 */
export interface FileTreeUpdateEvent extends BaseWorkspaceEvent {
  type: 'file_tree_update';
  commitHash?: string;
}

/**
 * File content update event
 */
export interface FileContentUpdateEvent extends BaseWorkspaceEvent {
  type: 'file_content_update';
  filePath: string;
  content: string;
  language: string;
}

/**
 * Workspace closed event
 */
export interface WorkspaceClosedEvent extends BaseWorkspaceEvent {
  type: 'workspace_closed';
}

/**
 * Cloning started event
 */
export interface CloningStartedEvent extends BaseWorkspaceEvent {
  type: 'cloning_started';
}

/**
 * Union type for all workspace events
 */
export type WorkspaceEvent =
  | WorkspaceReadyEvent
  | FileTreeUpdateEvent
  | FileContentUpdateEvent
  | WorkspaceClosedEvent
  | CloningStartedEvent;

/**
 * Callback options for workspace subscription
 */
export interface WorkspaceSubscriptionCallbacks {
  onWorkspaceReady?: (event: WorkspaceReadyEvent) => void;
  onFileTreeUpdate?: (event: FileTreeUpdateEvent) => void;
  onFileContentUpdate?: (event: FileContentUpdateEvent) => void;
  onWorkspaceClosed?: (event: WorkspaceClosedEvent) => void;
  onCloningStarted?: (event: CloningStartedEvent) => void;
}

/**
 * Custom hook to subscribe to real-time workspace events via WebSocket
 *
 * Handles automatic subscription when component mounts and cleanup when unmounts.
 * Uses throttling to prevent excessive refetches during rapid file changes.
 *
 * @param executionId - The parent workflow execution ID to subscribe to
 * @param callbacks - Object containing callback functions for different event types
 *
 * @example
 * ```typescript
 * useWorkspaceSubscription(executionId, {
 *   onWorkspaceReady: (event) => {
 *     console.log('Workspace ready:', event.childExecutionId);
 *     refetchTree();
 *   },
 *   onFileTreeUpdate: (event) => {
 *     console.log('Files changed:', event.commitHash);
 *     refetchTree();
 *   },
 *   onWorkspaceClosed: () => {
 *     console.log('Workspace closed');
 *   }
 * });
 * ```
 */
export const useWorkspaceSubscription = (
  executionId: string | null | undefined,
  callbacks: WorkspaceSubscriptionCallbacks,
): void => {
  // Use refs to avoid recreating the callbacks on every render
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Throttle state refs for file tree updates
  const lastTreeRefetchTimeRef = useRef<number>(0);
  const pendingTreeRefetchRef = useRef<NodeJS.Timeout | null>(null);

  // Throttled file tree update handler
  const handleFileTreeUpdate = useCallback((event: FileTreeUpdateEvent) => {
    const now = Date.now();
    const timeSinceLastRefetch = now - lastTreeRefetchTimeRef.current;

    const doCallback = (): void => {
      callbacksRef.current.onFileTreeUpdate?.(event);
    };

    if (timeSinceLastRefetch >= THROTTLE_INTERVAL_MS) {
      // Throttle window passed - callback immediately (leading edge)
      doCallback();
      lastTreeRefetchTimeRef.current = now;

      // Clear any pending trailing refetch since we just called
      if (pendingTreeRefetchRef.current) {
        clearTimeout(pendingTreeRefetchRef.current);
        pendingTreeRefetchRef.current = null;
      }
    } else {
      // Within throttle window - schedule trailing edge callback if not already scheduled
      if (!pendingTreeRefetchRef.current) {
        const remainingTime = THROTTLE_INTERVAL_MS - timeSinceLastRefetch;
        pendingTreeRefetchRef.current = setTimeout(() => {
          doCallback();
          lastTreeRefetchTimeRef.current = Date.now();
          pendingTreeRefetchRef.current = null;
        }, remainingTime);
      }
    }
  }, []);

  // Main event handler
  const handleWorkspaceEvent = useCallback(
    (data: WorkspaceEvent) => {
      // Only trigger callback if the event is for the subscribed execution
      if (data.parentExecutionId !== executionId && data.executionId !== executionId) {
        return;
      }

      switch (data.type) {
        case 'workspace_ready':
          callbacksRef.current.onWorkspaceReady?.(data);
          break;
        case 'file_tree_update':
          // Use throttled handler for file tree updates
          handleFileTreeUpdate(data);
          break;
        case 'file_content_update':
          callbacksRef.current.onFileContentUpdate?.(data);
          break;
        case 'workspace_closed':
          callbacksRef.current.onWorkspaceClosed?.(data);
          break;
        case 'cloning_started':
          callbacksRef.current.onCloningStarted?.(data);
          break;
      }
    },
    [executionId, handleFileTreeUpdate],
  );

  useEffect((): (() => void) | undefined => {
    // Guard clause: Don't subscribe if no execution ID or WebSocket not connected
    if (!executionId || !websocketService.isConnectedToServer()) {
      return;
    }

    // Note: We reuse the workflow subscription which now also subscribes to workspace events
    // The backend handles both workflow and workspace subscriptions together

    // Listen for workspace events
    websocketService.on<WorkspaceEvent>('workspace_event', handleWorkspaceEvent);

    // Cleanup function
    return (): void => {
      // Remove the event listener
      websocketService.removeListener('workspace_event', handleWorkspaceEvent);

      // Clear any pending throttled refetch
      if (pendingTreeRefetchRef.current) {
        clearTimeout(pendingTreeRefetchRef.current);
        pendingTreeRefetchRef.current = null;
      }
    };
  }, [executionId, handleWorkspaceEvent]);
};
