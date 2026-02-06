import React, { useEffect, useCallback, useRef, useState } from 'react';
import { websocketService } from '../../services/clients/socketClient';
import { toast } from 'sonner';
import { useAuthContext } from '../../providers/AuthProvider';
import { useNavigate, useLocation } from 'react-router-dom';
import { NativeInboundMessageType, reactNativeBridge } from '../../utils/reactNativeBridge';
import { useZero } from '@rocicorp/zero/react';
import { mutators } from '../../zero/mutators';
import { callActor } from '../../machines/callMachine';
import { v4 as uuidv4 } from 'uuid';
import { roomActor } from '../../machines/roomMachine';
import { CallType } from '@xyne/shared';

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
    };
    createdAt: Date;
  };
  timestamp: string;
}

export const NotificationHandler: React.FC = () => {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();
  const isConnectedRef = useRef(false);
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
  const [suppressNativeToasts, setSuppressNativeToasts] = useState<boolean>(() =>
    reactNativeBridge.isAvailable(),
  );

  const handleNotification = useCallback(
    (data: NotificationData): void => {
      try {
        // Check if user is currently in VS Code editor
        const isOnVSCode = location.pathname === '/vscode';

        if (
          isElectron &&
          window.electronAPI &&
          typeof window.electronAPI.showNotification === 'function'
        ) {
          window.electronAPI.showNotification({
            title: data.notification.title,
            body: data.notification.message,
            actionUrl: data.notification.actionUrl || '/chat',
          });
        } else if (!(reactNativeBridge.isAvailable() && suppressNativeToasts)) {
          playNotificationSound();

          const toastFn = getToastFn(data.notification.type);
          toastFn(data.notification.title, {
            description: data.notification.message,
            action: data.notification.actionUrl
              ? {
                  label: 'View',
                  onClick: (): void => {
                    if (data.notification.actionUrl) {
                      // If in VS Code editor and notification has thread/conversation data, open thread in editor
                      if (
                        isOnVSCode &&
                        (data.notification.data?.conversationId ||
                          data.notification.data?.channelId)
                      ) {
                        // Dispatch custom event to open thread in VS Code workspace
                        window.dispatchEvent(
                          new CustomEvent('vscode-open-thread', {
                            detail: {
                              conversationId: data.notification.data.conversationId,
                              channelId: data.notification.data.channelId,
                              messageId: data.notification.data.messageId,
                            },
                          }),
                        );
                      } else {
                        // Normal navigation behavior
                        void navigate(data.notification.actionUrl);
                      }
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
    [navigate, location.pathname, isElectron, suppressNativeToasts],
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
              // Set native active call ID in callActor FIRST (before Zero mutator)
              // This immediately prevents IncomingCallModal from showing
              callActor.send({ type: 'SET_NATIVE_ACTIVE_CALL', callId: activeCallId });
              void zero.mutate(
                mutators.calls.join({
                  callId: activeCallId,
                  timestamp: Date.now(),
                  participantId: uuidv4(),
                }),
              );
              nativeJoinedCallsRef.current.add(activeCallId);
            }

            // If there's a call that ended, sync the leave
            if (endedCallId) {
              console.log('[NotificationHandler] Syncing pending leave:', endedCallId);
              // Clear native active call ID in callActor
              callActor.send({ type: 'CLEAR_NATIVE_ACTIVE_CALL' });
              const timestamp = Date.now();
              // Ensure join is recorded first (idempotent)
              void zero.mutate(
                mutators.calls.join({
                  callId: endedCallId,
                  timestamp,
                  participantId: uuidv4(),
                }),
              );
              void zero.mutate(
                mutators.calls.leave({ callId: endedCallId, timestamp: Date.now() }),
              );
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
            // Set native active call ID in callActor FIRST (before Zero mutator)
            // This immediately prevents IncomingCallModal from showing
            callActor.send({ type: 'SET_NATIVE_ACTIVE_CALL', callId });
            // Write to Zero DB that user has joined the call
            void zero.mutate(
              mutators.calls.join({
                callId,
                timestamp: Date.now(),
                participantId: uuidv4(),
              }),
            );
            console.log('[NotificationHandler] Successfully wrote call join to Zero DB:', callId);
          } catch (error) {
            console.error('[NotificationHandler] Failed to write call join to Zero:', error);
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
              console.log(
                '[NotificationHandler] Call not tracked, ensuring join before leave:',
                callId,
              );
              void zero.mutate(
                mutators.calls.join({
                  callId,
                  timestamp: Date.now(),
                  participantId: uuidv4(),
                }),
              );
            }

            // Clear native active call ID in callActor
            callActor.send({ type: 'CLEAR_NATIVE_ACTIVE_CALL' });

            // Write to Zero DB that user has left the call
            void zero.mutate(mutators.calls.leave({ callId, timestamp: Date.now() }));
            console.log('[NotificationHandler] Successfully wrote call leave to Zero DB:', callId);
            // Remove from tracked calls if present
            nativeJoinedCallsRef.current.delete(callId);
          } catch (error) {
            console.error('[NotificationHandler] Failed to write call leave to Zero:', error);
          }
        }
      },
    );

    return unsubscribe;
  }, [zero]);

  useEffect(() => {
    if (isElectron && window.electronAPI && typeof window.electronAPI.onNavigateTo === 'function') {
      const handleNavigate = (url: string): void => {
        // Check if user is on VS Code page and URL is a chat URL
        const isOnVSCode = location.pathname === '/vscode';

        if (isOnVSCode && url.startsWith('/chat/')) {
          // Parse conversation and channel from URL like /chat/dir/{channelId}/{conversationId}
          const urlParts = url.split('/').filter(Boolean);
          if (urlParts.length >= 3 && urlParts[0] === 'chat') {
            const channelId = urlParts[2];
            const conversationId = urlParts[3]?.split('#')[0]; // Remove hash if present

            // Dispatch event to open thread in VS Code workspace
            window.dispatchEvent(
              new CustomEvent('vscode-open-thread', {
                detail: { conversationId, channelId },
              }),
            );
            return;
          }
        }

        // Default: navigate normally
        void navigate(url);
      };

      const cleanup = window.electronAPI.onNavigateTo(handleNavigate);
      return cleanup;
    }
    return undefined;
  }, [navigate, isElectron, location.pathname]);

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

          // Notify backend that user is online to deliver pending notifications
          const socket = websocketService.getSocket();
          if (socket) {
            socket.emit('user_online', { userId: user.id });
          }

          // Start heartbeat using Web Worker-based service
          // This is immune to browser background tab throttling
          // heartbeatService.start(30000); // 30 seconds
        })
        .catch(() => {
          // WebSocket connection failed - will retry on next user state change
          isConnectedRef.current = false;
        });
    }

    return (): void => {
      // Stop heartbeat service on cleanup
      // heartbeatService.stop();

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
    case 'workflow_failure':
      return toast.error;
    default:
      return toast.info;
  }
}
