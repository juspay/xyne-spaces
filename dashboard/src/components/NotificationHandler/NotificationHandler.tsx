import React, { useEffect, useCallback, useRef, useState } from 'react';
import { websocketService } from '../../services/clients/socketClient';
import { toast } from 'sonner';
import { useAuthContext } from '../../providers/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { NativeInboundMessageType, reactNativeBridge } from '../../utils/reactNativeBridge';
import { useZero } from '../../hooks/useZero';
import { callActor } from '../../machines/callMachine';
import { roomActor } from '../../machines/roomMachine';
import { CallType } from '@xyne/shared';
import { setupPresenceListeners, cleanupPresenceListeners } from '../../machines/stateMachine';
import { queryCacheActor, type Conversation } from '../../machines/queryCacheMachine';
import { MEETING_DETECTION_ENABLED_KEY } from '../../constants/settings';
import { sendRecordingEvent, useRecordingStore } from '../../hooks/useRecordingStore';

// Function to play notification sound
const playNotificationSound = (): void => {
  try {
    const audio = new Audio('/sounds/notification.wav');
    audio.volume = 0.5; // Set volume to 50%
    audio.play().catch(() => {});
  } catch (error) {
    console.error('Error playing notification sound:', error);
  }
};

interface NotificationData {
  notification: {
    id: string;
    type: string;
    title: string;
    message: string;
    actionUrl?: string;
    data?: {
      channelId?: string;
      conversationId?: string;
      messageId?: string;
      senderId?: string;
      senderName?: string;
      channelTitle?: string;
      messageType?: string;
      canvasId?: string;
      blockId?: string;
      conversation?: Conversation;
    };
    metadata?: {
      notificationType?: string;
      [key: string]: unknown;
    };
    createdAt: Date;
  };
  timestamp: string;
}

const buildChatActionUrl = (notification: NotificationData['notification']): string | undefined => {
  if (notification.actionUrl) return notification.actionUrl;

  const channelId = notification.data?.channelId;
  const conversationId = notification.data?.conversationId;
  const messageId = notification.data?.messageId;
  const isDirectMessage = notification.type.toLowerCase() === 'direct_message';
  const routeBase = isDirectMessage ? `/chat/dm/${channelId}` : `/chat/${channelId}`;

  if (!channelId) return undefined;
  if (conversationId && messageId) {
    if (isDirectMessage) {
      return `${routeBase}#origin=${conversationId}&messageId=${messageId}`;
    }
    return `${routeBase}/${conversationId}#origin=${conversationId}&messageId=${messageId}`;
  }
  if (conversationId) {
    return `${routeBase}#origin=${conversationId}`;
  }

  return routeBase;
};

export const NotificationHandler: React.FC = () => {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const isConnectedRef = useRef(false);
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
  const [suppressNativeToasts, setSuppressNativeToasts] = useState<boolean>(() =>
    reactNativeBridge.isAvailable(),
  );

  const handleNotification = useCallback(
    (data: NotificationData): void => {
      try {
        // Skip silent data-only notifications meant for mobile tray clearing
        const type = data.notification?.type?.toLowerCase();
        if (type === 'channel_read' || type === 'thread_read') {
          return;
        }
        // Cache conversation data from notification payload (if available)
        // This pre-populates the cache so navigating to the channel is instant
        const conversationPayload = data.notification.data?.conversation;
        const channelId = data.notification.data?.channelId;
        if (conversationPayload && channelId) {
          queryCacheActor.send({
            type: 'MERGE_CONVERSATION',
            channelId,
            conversation: conversationPayload,
          });
        }

        // For canvas notifications, construct actionUrl from data if not provided
        const canvasRedirectUrl =
          !data.notification.actionUrl && data.notification.data?.canvasId
            ? data.notification.data.blockId
              ? `/redirected?type=canvas&canvasId=${encodeURIComponent(data.notification.data.canvasId)}&blockId=${encodeURIComponent(data.notification.data.blockId)}`
              : `/redirected?type=canvas&canvasId=${encodeURIComponent(data.notification.data.canvasId)}`
            : undefined;
        const fallbackChatActionUrl = buildChatActionUrl(data.notification);
        const resolvedActionUrl =
          data.notification.actionUrl || canvasRedirectUrl || fallbackChatActionUrl;

        if (
          isElectron &&
          window.electronAPI &&
          typeof window.electronAPI.showNotification === 'function'
        ) {
          playNotificationSound();
          window.electronAPI.showNotification({
            title: data.notification.title,
            body: data.notification.message,
            actionUrl: resolvedActionUrl || '/chat',
          });
        } else if (!(reactNativeBridge.isAvailable() && suppressNativeToasts)) {
          playNotificationSound();

          // Use metadata.notificationType if available, otherwise use notification.type
          const notificationType =
            data.notification.metadata?.notificationType || data.notification.type;
          const toastFn = getToastFn(notificationType);
          toastFn(data.notification.title, {
            description: data.notification.message,
            action: resolvedActionUrl
              ? {
                  label: 'View',
                  onClick: (): void => {
                    if (resolvedActionUrl) {
                      void navigate(resolvedActionUrl);
                    }
                  },
                }
              : {
                  label: 'View',
                  onClick: (): void => {
                    void navigate('/chat');
                  },
                },
            duration: 5000,
          });
        }

        // Send acknowledgment back to backend
        const socket = websocketService.getSocket();
        if (socket && data.notification.id) {
          socket.emit('notification_acknowledged', {
            notificationId: data.notification.id,
          });
        }
      } catch (error) {
        console.error('Error handling notification:', error);
      }
    },
    [navigate, isElectron, suppressNativeToasts],
  );

  const handleNotificationAckConfirmed = useCallback((): void => {}, []);

  const handleNotificationUpdate = useCallback((): void => {}, []);

  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return undefined;
    }

    const unsubscribe = reactNativeBridge.on(
      NativeInboundMessageType.NATIVE_NOTIFICATION_PERMISSION,
      message => {
        setSuppressNativeToasts(
          reactNativeBridge.isAvailable() && Boolean(message.payload?.granted),
        );
      },
    );

    return unsubscribe;
  }, []);

  // Handle NATIVE_CALL_JOINED - write to Zero DB when native joins a call from notification
  const zero = useZero();

  // Track call IDs that were joined via native (to handle leave when call ends)
  const nativeJoinedCallsRef = useRef<Set<string>>(new Set());

  // Listen for pending call state from native (handles cold start race condition)
  // When app cold starts from VoIP, JS may not be ready when call joins/ends
  // Native sends this message when WebView becomes ready
  useEffect(() => {
    if (!reactNativeBridge.isAvailable() || !zero) {
      return undefined;
    }

    const unsubscribe = reactNativeBridge.on(
      NativeInboundMessageType.NATIVE_PENDING_CALL_STATE,
      message => {
        void (() => {
          try {
            const pendingState = message.payload as
              | { activeCallId?: string; endedCallId?: string }
              | undefined;

            if (!pendingState) {
              console.log('[NotificationHandler] No pending call state from native');
              return;
            }

            console.log(
              '[NotificationHandler] Received pending call state from native:',
              pendingState,
            );

            const { activeCallId, endedCallId } = pendingState;

            // If there's an active call that was joined, ensure it's in Zero
            if (activeCallId) {
              console.log('[NotificationHandler] Syncing pending join:', activeCallId);
              // Set native active call ID in callActor FIRST
              // This immediately prevents IncomingCallModal from showing
              callActor.send({ type: 'SET_NATIVE_ACTIVE_CALL', callId: activeCallId });
              nativeJoinedCallsRef.current.add(activeCallId);
            }

            // If there's a call that ended, sync the leave
            if (endedCallId) {
              console.log('[NotificationHandler] Syncing pending leave:', endedCallId);
              // Clear native active call ID in callActor
              callActor.send({ type: 'CLEAR_NATIVE_ACTIVE_CALL' });
              const timestamp = Date.now();
              console.log('[NotificationHandler] Call ended:', endedCallId, timestamp);
            }

            console.log('[NotificationHandler] Successfully synced pending call state');
          } catch (error) {
            console.error('[NotificationHandler] Failed to sync pending call state:', error);
          }
        })();
      },
    );

    return unsubscribe;
  }, [zero]);

  // Listen for native callback requests (Start Call action from notification)
  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return undefined;
    }

    const unsubscribe = reactNativeBridge.on(
      NativeInboundMessageType.NATIVE_REQUEST_CALLBACK,
      message => {
        const payload = message.payload || {};
        // eslint-disable-next-line no-console
        console.log('[NotificationHandler] Received NATIVE_REQUEST_CALLBACK', payload);
        const channelId = payload?.channelId || '';

        roomActor.send({
          type: 'INITIATE_CALL',
          callType: CallType.AUDIO,
          channelId,
          zero,
          viewMode: 'full',
        });
      },
    );

    return unsubscribe;
  }, [zero]);

  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return undefined;
    }

    const unsubscribe = reactNativeBridge.on(
      NativeInboundMessageType.NATIVE_CALL_JOINED,
      message => {
        console.log('[NotificationHandler] Received NATIVE_CALL_JOINED:', message.payload);
        const { callId } = message.payload || {};
        if (callId && zero) {
          try {
            // Track this call as joined via native
            nativeJoinedCallsRef.current.add(callId);
            // Set native active call ID in callActor FIRST
            // This immediately prevents IncomingCallModal from showing
            callActor.send({ type: 'SET_NATIVE_ACTIVE_CALL', callId });
            console.log('[NotificationHandler] Call started:', callId);
          } catch (error) {
            console.error('[NotificationHandler] Failed to handle call start:', error);
          }
        }
      },
    );

    return unsubscribe;
  }, [zero]);

  // Handle LIVEKIT_CALL_ENDED - write leave to Zero DB when native call ends
  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return undefined;
    }

    const unsubscribe = reactNativeBridge.on(
      NativeInboundMessageType.LIVEKIT_CALL_ENDED,
      message => {
        console.log('[NotificationHandler] Received LIVEKIT_CALL_ENDED:', message.payload);
        const { callId } = message.payload || {};

        // Always write leave for native calls - handles cold start race condition
        // where NATIVE_CALL_JOINED may fire before NotificationHandler mounts
        // The leave mutator is idempotent (checks if already left)
        if (callId && zero) {
          try {
            // First ensure join was recorded (may have been missed during cold start)
            // This ensures participant has ACCEPTED response before we leave
            if (!nativeJoinedCallsRef.current.has(callId)) {
              console.log('[NotificationHandler] Call not tracked:', callId);
            }

            // Clear native active call ID in callActor
            callActor.send({ type: 'CLEAR_NATIVE_ACTIVE_CALL' });

            console.log('[NotificationHandler] Call ended:', callId);
            // Remove from tracked calls if present
            nativeJoinedCallsRef.current.delete(callId);
          } catch (error) {
            console.error('[NotificationHandler] Failed to handle call end:', error);
          }
        }
      },
    );

    return unsubscribe;
  }, [zero]);

  useEffect(() => {
    if (isElectron && window.electronAPI && typeof window.electronAPI.onNavigateTo === 'function') {
      const handleNavigate = (url: string): void => {
        void navigate(url);
      };

      const cleanup = window.electronAPI.onNavigateTo(handleNavigate);
      return cleanup;
    }
    return undefined;
  }, [navigate, isElectron]);

  useEffect(() => {
    const meetingDetector = window.electronAPI?.meetingDetector;
    if (!isElectron || !meetingDetector) return;
    // Sync stored preference to main process on startup
    meetingDetector.setEnabled(localStorage.getItem(MEETING_DETECTION_ENABLED_KEY) !== 'false');
    return meetingDetector.onStartRecordingFromMeeting(() => {
      sendRecordingEvent({ type: 'requestAutoStart' });
    });
  }, [isElectron]);

  // Handle stop signal from the floating recording pill's Stop button
  useEffect(() => {
    const meetingDetector = window.electronAPI?.meetingDetector;
    if (!isElectron || !meetingDetector) return;
    return meetingDetector.onStopRecordingFromMeeting(() => {
      sendRecordingEvent({ type: 'requestStop' });
    });
  }, [isElectron]);

  // Hide the floating pill when recording transitions from active to inactive
  // (user stopped it manually in the recordings UI, not just via the pill Stop button)
  const recordingStatus = useRecordingStore(ctx => ctx.status);
  const wasRecordingActiveRef = useRef(false);
  useEffect(() => {
    if (!isElectron) return;
    const isActive = recordingStatus === 'recording' || recordingStatus === 'paused';
    if (wasRecordingActiveRef.current && !isActive) {
      window.electronAPI?.ipcSend?.('recording-pill:recording-stopped', true);
    }
    wasRecordingActiveRef.current = isActive;
  }, [isElectron, recordingStatus]);

  const handleNotificationRef = useRef(handleNotification);
  const handleNotificationAckConfirmedRef = useRef(handleNotificationAckConfirmed);
  const handleNotificationUpdateRef = useRef(handleNotificationUpdate);

  useEffect(() => {
    handleNotificationRef.current = handleNotification;
    handleNotificationAckConfirmedRef.current = handleNotificationAckConfirmed;
    handleNotificationUpdateRef.current = handleNotificationUpdate;
  }, [handleNotification, handleNotificationAckConfirmed, handleNotificationUpdate]);

  useEffect(() => {
    if (user && !isConnectedRef.current) {
      websocketService
        .connect()
        .then(() => {
          isConnectedRef.current = true;

          // Set up notification listeners after connection is established
          websocketService.on('notification_received', (n: NotificationData) =>
            handleNotificationRef.current(n),
          );
          websocketService.on('notification_ack_confirmed', () =>
            handleNotificationAckConfirmedRef.current(),
          );
          websocketService.on('notification_updated', () => handleNotificationUpdateRef.current());

          // Setup presence listeners after socket is connected
          setupPresenceListeners(user.id, websocketService);

          // Request current presence state since we may have missed the initial broadcast
          const socket = websocketService.getSocket();
          if (socket) {
            socket.emit('request_presence_state');
          }
        })
        .catch(() => {
          // WebSocket connection failed - will retry on next user state change
          isConnectedRef.current = false;
        });
    }
    return (): void => {
      // Cleanup presence listeners
      cleanupPresenceListeners(websocketService);

      if (isConnectedRef.current) {
        websocketService.removeListener('notification_received', handleNotificationRef.current);
        websocketService.removeListener(
          'notification_ack_confirmed',
          handleNotificationAckConfirmedRef.current,
        );
        websocketService.removeListener(
          'notification_updated',
          handleNotificationUpdateRef.current,
        );
      }

      websocketService.disconnect();
      isConnectedRef.current = false;
    };
  }, [user]);

  // This component doesn't render anything visible
  return null;
};

// Helper function to determine toast function based on notification type
function getToastFn(notificationType: string) {
  switch (notificationType.toLowerCase()) {
    case 'mention':
      return toast.warning;
    case 'direct_message':
      return toast.info;
    case 'new_message':
    case 'thread_reply':
      return toast.success;
    case 'ticket_assignment':
    case 'ticket_status_change':
      return toast.info;
    case 'workflow_completion':
      return toast.success;
    case 'call_reminder':
      return toast.warning;
    case 'call_scheduled':
      return toast.info;
    case 'call_updated':
      return toast.info;
    case 'workflow_failure':
      return toast.error;
    case 'email_fetch_completed':
      return toast.success;
    case 'email_fetch_failed':
      return toast.error;
    case 'collection_shared':
      return toast.success;
    case 'collection_deleted':
      return toast.warning;
    default:
      return toast.info;
  }
}
