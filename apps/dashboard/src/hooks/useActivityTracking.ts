import { logger, Event as LogEvent } from '../utils/logger';
import { useCallback, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { websocketService } from '../services/clients/socketClient';
import { Platform, TriggerType, ActivityEventPayload, TrackActivityOptions } from '@xyne/shared';
import { isElectronApp } from '../utils/electronApp';
import { useSelf } from './useUsers';
import { ENABLE_ACTIVITY_LOG } from '../config';

export const WS_ACTIVITY_EVENT = 'user_activity_event';

/**
 * Detect platform
 */
function detectPlatform(): Platform {
  if (isElectronApp()) {
    return Platform.ELECTRON;
  }
  return Platform.WEB;
}

/**
 * Hook for activity tracking
 * Automatically captures userId from useSelf() and manages session ID
 *
 * Usage:
 * ```tsx
 * const { track } = useActivityTracking();
 *
 * track({
 *   eventCategory: 'CTA',
 *   eventName: 'CREATE_TICKET_BUTTON',
 *   eventType: 'BUTTON_CLICK',
 * });
 * ```
 */
export function useActivityTracking() {
  const currentUser = useSelf();
  const platform = useMemo(() => detectPlatform(), []);

  // Create session ID once and persist it for the app lifecycle
  const sessionIdRef = useRef<string>(uuidv4());
  const sessionId = sessionIdRef.current;

  /**
   * Build activity event from user-provided options
   */
  const buildActivityEvent = useCallback(
    (options: TrackActivityOptions): ActivityEventPayload | null => {
      if (!currentUser?.id) {
        return null;
      }

      const event: ActivityEventPayload = {
        user_id: currentUser.id,
        session_id: sessionId,
        event_category: options.eventCategory,
        event_name: options.eventName,
        url: options.url ?? window.location.pathname + window.location.hash,
        trigger_type: TriggerType.CLICK,
        platform,
        timestamp: Date.now(),
      };

      if (options.eventLabel !== undefined) {
        event.event_label = options.eventLabel;
      }
      if (options.contextMetadata !== undefined) {
        event.context_metadata = options.contextMetadata;
      }

      return event;
    },
    [currentUser?.id, sessionId, platform],
  );

  /**
   * Track an activity event
   */
  const track = useCallback(
    (options: TrackActivityOptions): void => {
      if (!currentUser?.id) {
        return;
      }
      if (!ENABLE_ACTIVITY_LOG) {
        return;
      }

      try {
        const event = buildActivityEvent(options);
        if (event && websocketService.isConnectedToServer()) {
          websocketService.emit(WS_ACTIVITY_EVENT, event);
        }
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[ActivityTracking] Failed to track event:'),
          error: error,
        });
      }
    },
    [currentUser?.id, buildActivityEvent],
  );

  return {
    track,
    sessionId,
    userId: currentUser?.id,
    platform,
  };
}
