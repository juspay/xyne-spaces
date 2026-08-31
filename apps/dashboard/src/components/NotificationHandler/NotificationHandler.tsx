import { logger, Event as LogEvent } from '../../utils/logger';
import React, { useEffect, useCallback, useRef, useState } from 'react';
import axios from 'axios';
import { websocketService } from '../../services/clients/socketClient';
import { hydrateDynamicHeaders } from '../../services/clients/dynamicHeaders';
import { useDeferredClientCommand, type ClientCommand } from '../../hooks/useDeferredClientCommand';
import { toast } from 'sonner';
import { useAuthContext } from '../../providers/AuthProvider';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE_URL } from '../../config';
import { queryClient } from '../../services/clients/queryClient';
import { NativeInboundMessageType, reactNativeBridge } from '../../utils/reactNativeBridge';
import { useZero } from '../../hooks/useZero';
import { useAllChannels } from '../../hooks/useChannels';
import { callActor } from '../../machines/callMachine';
import { roomActor } from '../../machines/roomMachine';
import { useSelector } from '@xstate/react';
import { CallType, ChannelType } from '@xyne/shared';
import { buildSdlcPath } from '@xyne/shared/sdlc';
import { setupPresenceListeners, cleanupPresenceListeners } from '../../machines/stateMachine';
import { queryCacheActor, type Conversation } from '../../machines/queryCacheMachine';
import { MEETING_DETECTION_ENABLED_KEY } from '../../constants/settings';
import {
  sendRecordingEvent,
  stopRecordingForNavigation,
  stopRecordingForTeardown,
  useRecordingStore,
} from '../../hooks/useRecordingStore';
import { sendSosAlertEvent } from '../../stores/sosAlertStore';
import { confirmRecordingInterrupt } from '../Recording/RecordingInterruptGuard/RecordingInterruptGuard';

// Singleton: a fresh Audio element PER NOTIFICATION leaked native listener
// registrations and media elements — heap analysis showed "JS event
// listeners" accumulating all session for notification-heavy (support) users.
let notificationAudio: HTMLAudioElement | null = null;

// Function to play notification sound
const playNotificationSound = (): void => {
  try {
    if (!notificationAudio) {
      notificationAudio = new Audio('/sounds/notification.wav');
      notificationAudio.volume = 0.5; // Set volume to 50%
    }
    notificationAudio.currentTime = 0;
    notificationAudio.play().catch(() => undefined);
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Error playing notification sound:'),
      error: error,
    });
  }
};

interface NotificationData {
  notification: {
    id: string;
    type: string;
    title: string;
    message: string;
    actionUrl?: string;
    // Present only on cross-workspace broadcast from the backend.
    workspaceId?: string;
    workspaceName?: string;
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
      commentThreadId?: string;
      conversation?: Conversation;
      notificationType?: string;
      ticketId?: string;
    };
    metadata?: {
      notificationType?: string;
      [key: string]: unknown;
    };
    createdAt: Date;
  };
  timestamp: string;
}

// Router is /:workspaceId/... so cross-workspace deep links need the prefix.
const withWorkspacePrefix = (url: string, workspaceId?: string): string => {
  if (!workspaceId) return url;
  if (!url.startsWith('/')) return url;
  if (url.startsWith(`/${workspaceId}/`) || url === `/${workspaceId}`) return url;
  return `/${workspaceId}${url}`;
};

const buildChatActionUrl = (notification: NotificationData['notification']): string | undefined => {
  const workspaceId = notification.workspaceId;

  if (notification.actionUrl) {
    return withWorkspacePrefix(notification.actionUrl, workspaceId);
  }

  const channelId = notification.data?.channelId;
  const conversationId = notification.data?.conversationId;
  const messageId = notification.data?.messageId;
  const isDirectMessage = notification.type.toLowerCase() === 'direct_message';
  const routeBase = isDirectMessage ? `/chat/dm/${channelId}` : `/chat/${channelId}`;

  if (!channelId) return undefined;
  let path: string;
  if (conversationId && messageId) {
    if (isDirectMessage) {
      path = `${routeBase}#origin=${conversationId}&messageId=${messageId}`;
    } else {
      path = `${routeBase}/${conversationId}?focusThread=1#origin=${conversationId}&messageId=${messageId}`;
    }
  } else if (conversationId) {
    path = `${routeBase}#origin=${conversationId}`;
  } else {
    path = routeBase;
  }
  return withWorkspacePrefix(path, workspaceId);
};

export const NotificationHandler: React.FC = () => {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const { workspaceId: activeWorkspaceId } = useParams<{ workspaceId?: string }>();
  const activeWorkspaceIdRef = useRef<string | undefined>(activeWorkspaceId);
  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);
  // Read inside the socket callback, which is registered once.
  const allChannels = useAllChannels();
  const sdlcChannelIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    sdlcChannelIdsRef.current = new Set(
      allChannels.filter(channel => channel.type === ChannelType.SDLC).map(channel => channel.id),
    );
  }, [allChannels]);
  const isConnectedRef = useRef(false);
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
  const [suppressNativeToasts, setSuppressNativeToasts] = useState<boolean>(() =>
    reactNativeBridge.isAvailable(),
  );

  // Cross-workspace clicks: switch-workspace + hard reload (flips session cookie).
  // Same-workspace clicks stay in the SPA.
  const handleNotificationClick = useCallback(
    async (actionUrl: string | undefined, targetWorkspaceId: string | undefined): Promise<void> => {
      const resolvedUrl = actionUrl || (targetWorkspaceId ? `/${targetWorkspaceId}/chat` : '/chat');
      const currentWorkspaceId = activeWorkspaceIdRef.current;

      if (targetWorkspaceId && targetWorkspaceId !== currentWorkspaceId) {
        if (!(await confirmRecordingInterrupt('workspaceSwitch'))) return;
        try {
          await axios.post(
            `${API_BASE_URL}/auth/switch-workspace`,
            { workspaceId: targetWorkspaceId },
            { withCredentials: true },
          );
          logger.info(LogEvent.INFO, {
            type: 'migrated_console_log',
            message: String(
              `[NotificationHandler] Switched workspace from=${currentWorkspaceId} to=${targetWorkspaceId}`,
            ),
          });
          queryClient.clear();
          window.location.href = resolvedUrl;
          return;
        } catch (error) {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[NotificationHandler] Workspace switch failed:'),
            error: error,
          });
          toast.error('Failed to switch workspace. Please try again.');
          return; // Do not navigate — session cookie was not switched.
        }
      }

      void navigate(resolvedUrl);
    },
    [navigate],
  );

  const handleNotification = useCallback(
    (data: NotificationData): void => {
      try {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String(
            `[NotificationHandler] Notification received id=${data.notification.id} type=${data.notification.type} workspace=${data.notification.workspaceId ?? 'current'}`,
          ),
        });
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
            ? (() => {
                const canvasParams = new URLSearchParams({
                  type: 'canvas',
                  canvasId: data.notification.data.canvasId,
                });
                if (data.notification.data.blockId) {
                  canvasParams.set('blockId', data.notification.data.blockId);
                }
                if (data.notification.data.commentThreadId) {
                  canvasParams.set('commentThreadId', data.notification.data.commentThreadId);
                }
                return `/redirected?${canvasParams.toString()}`;
              })()
            : undefined;
        const fallbackChatActionUrl = buildChatActionUrl(data.notification);
        const notificationWorkspaceId = data.notification.workspaceId;
        if (notificationWorkspaceId && notificationWorkspaceId !== activeWorkspaceIdRef.current) {
          logger.info(LogEvent.INFO, {
            type: 'migrated_console_log',
            message: String(
              `[NotificationHandler] Cross-workspace notification received id=${data.notification.id} from=${notificationWorkspaceId} current=${activeWorkspaceIdRef.current}`,
            ),
          });
        }
        // Socket delivery spreads metadata into `data`; the REST row keeps `metadata`.
        const ids = { ...data.notification.metadata, ...data.notification.data };
        // No builder knows the SDLC routes, so the hub's own paths are built here
        // from the ids they all send, against channels the client already holds.
        const sdlcActionUrl =
          ids.channelId && sdlcChannelIdsRef.current.has(ids.channelId)
            ? buildSdlcPath({
                channelId: ids.channelId,
                canvasId: ids.canvasId,
                ticketId: ids.ticketId,
                conversationId: ids.conversationId,
                messageId: ids.messageId,
                blockId: ids.blockId,
                commentThreadId: ids.commentThreadId,
              })
            : undefined;
        const resolvedRawActionUrl =
          sdlcActionUrl ||
          data.notification.actionUrl ||
          canvasRedirectUrl ||
          fallbackChatActionUrl;
        const resolvedActionUrl = resolvedRawActionUrl
          ? withWorkspacePrefix(
              resolvedRawActionUrl,
              // Unprefixed SDLC paths bind :workspaceId to "sdlc" — never ship one.
              notificationWorkspaceId ?? activeWorkspaceIdRef.current,
            )
          : undefined;

        // Always show workspace at the top when available, matching Slack.
        const bannerTitle = data.notification.workspaceName || data.notification.title;
        const bannerSubtitle = data.notification.workspaceName
          ? data.notification.title
          : undefined;

        // SOS alerts (safety escalations) — show a native notification for
        // the ping, plus a persistent in-app toast (SosAlertBanner) that stays
        // until the user explicitly dismisses or clicks View.
        const isSosAlert =
          data.notification.data?.notificationType === 'sos_alert' ||
          data.notification.metadata?.notificationType === 'sos_alert';
        if (isSosAlert) {
          logger.info(LogEvent.INFO, {
            type: 'migrated_console_log',
            message: String(
              `[NotificationHandler] SOS alert received id=${data.notification.id} workspace=${notificationWorkspaceId ?? 'current'}`,
            ),
          });
          // Bring Electron to foreground so the agent can't miss it.
          if (isElectron && window.electronAPI?.focusApp) {
            window.electronAPI.focusApp();
          }

          // Persistent in-app toast — survives navigation and page refresh.
          sendSosAlertEvent({
            type: 'addAlert',
            alert: {
              id: data.notification.id,
              title: data.notification.title,
              message: data.notification.message,
              ...(resolvedActionUrl && { actionUrl: resolvedActionUrl }),
              ...(notificationWorkspaceId && { workspaceId: notificationWorkspaceId }),
              ...(data.notification.workspaceName && {
                workspaceName: data.notification.workspaceName,
              }),
              receivedAt: Date.now(),
            },
          });

          // Confirm delivery to the backend.
          const sosSocket = websocketService.getSocket();
          if (sosSocket && data.notification.id) {
            sosSocket.emit('notification_acknowledged', {
              notificationId: data.notification.id,
            });
          }
          return;
        }

        if (
          isElectron &&
          window.electronAPI &&
          typeof window.electronAPI.showNotification === 'function'
        ) {
          playNotificationSound();
          // Fold sender into body
          const electronBody = bannerSubtitle
            ? `${bannerSubtitle}\n${data.notification.message}`
            : data.notification.message;
          window.electronAPI.showNotification({
            title: bannerTitle,
            body: electronBody,
            actionUrl:
              resolvedActionUrl ||
              (notificationWorkspaceId ? `/${notificationWorkspaceId}/chat` : '/chat'),
            ...(notificationWorkspaceId && { workspaceId: notificationWorkspaceId }),
          });
        } else if (!(reactNativeBridge.isAvailable() && suppressNativeToasts)) {
          playNotificationSound();

          // Use metadata.notificationType if available, otherwise use notification.type
          const notificationType =
            data.notification.metadata?.notificationType || data.notification.type;
          const toastFn = getToastFn(notificationType);
          const toastDescription = bannerSubtitle ? (
            <>
              {bannerSubtitle}
              <br />
              {data.notification.message}
            </>
          ) : (
            data.notification.message
          );
          toastFn(bannerTitle, {
            description: toastDescription,
            action: {
              label: 'View',
              onClick: (): void => {
                void handleNotificationClick(resolvedActionUrl, notificationWorkspaceId);
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
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error handling notification:'),
          error: error,
        });
      }
    },
    [navigate, isElectron, suppressNativeToasts, handleNotificationClick],
  );

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
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('[NotificationHandler] No pending call state from native'),
              });
              return;
            }

            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('[NotificationHandler] Received pending call state from native:'),
              context: [pendingState],
            });

            const { activeCallId, endedCallId } = pendingState;

            // If there's an active call that was joined, ensure it's in Zero
            if (activeCallId) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('[NotificationHandler] Syncing pending join:'),
                context: [activeCallId],
              });
              // Set native active call ID in callActor FIRST
              // This immediately prevents IncomingCallModal from showing
              callActor.send({ type: 'SET_NATIVE_ACTIVE_CALL', callId: activeCallId });
              nativeJoinedCallsRef.current.add(activeCallId);
            }

            // If there's a call that ended, sync the leave
            if (endedCallId) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('[NotificationHandler] Syncing pending leave:'),
                context: [endedCallId],
              });
              // Clear native active call ID in callActor
              callActor.send({ type: 'CLEAR_NATIVE_ACTIVE_CALL' });
              const timestamp = Date.now();
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('[NotificationHandler] Call ended:'),
                context: [endedCallId, timestamp],
              });
            }

            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('[NotificationHandler] Successfully synced pending call state'),
            });
          } catch (error) {
            logger.error(LogEvent.FRONTEND_ERROR, {
              type: 'migrated_console_error',
              message: String('[NotificationHandler] Failed to sync pending call state:'),
              error: error,
            });
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
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('[NotificationHandler] Received NATIVE_REQUEST_CALLBACK'),
          context: [payload],
        });
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
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('[NotificationHandler] Received NATIVE_CALL_JOINED:'),
          context: [message.payload],
        });
        const { callId } = message.payload || {};
        if (callId && zero) {
          try {
            // Track this call as joined via native
            nativeJoinedCallsRef.current.add(callId);
            // Set native active call ID in callActor FIRST
            // This immediately prevents IncomingCallModal from showing
            callActor.send({ type: 'SET_NATIVE_ACTIVE_CALL', callId });
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('[NotificationHandler] Call started:'),
              context: [callId],
            });
          } catch (error) {
            logger.error(LogEvent.FRONTEND_ERROR, {
              type: 'migrated_console_error',
              message: String('[NotificationHandler] Failed to handle call start:'),
              error: error,
            });
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
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('[NotificationHandler] Received LIVEKIT_CALL_ENDED:'),
          context: [message.payload],
        });
        const { callId } = message.payload || {};

        // Always write leave for native calls - handles cold start race condition
        // where NATIVE_CALL_JOINED may fire before NotificationHandler mounts
        // The leave mutator is idempotent (checks if already left)
        if (callId && zero) {
          try {
            // First ensure join was recorded (may have been missed during cold start)
            // This ensures participant has ACCEPTED response before we leave
            if (!nativeJoinedCallsRef.current.has(callId)) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('[NotificationHandler] Call not tracked:'),
                context: [callId],
              });
            }

            // Clear native active call ID in callActor
            callActor.send({ type: 'CLEAR_NATIVE_ACTIVE_CALL' });

            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('[NotificationHandler] Call ended:'),
              context: [callId],
            });
            // Remove from tracked calls if present
            nativeJoinedCallsRef.current.delete(callId);
          } catch (error) {
            logger.error(LogEvent.FRONTEND_ERROR, {
              type: 'migrated_console_error',
              message: String('[NotificationHandler] Failed to handle call end:'),
              error: error,
            });
          }
        }
      },
    );

    return unsubscribe;
  }, [zero]);

  useEffect(() => {
    if (isElectron && window.electronAPI && typeof window.electronAPI.onNavigateTo === 'function') {
      const handleNavigate = (url: string, workspaceId?: string): void => {
        void handleNotificationClick(url, workspaceId);
      };

      const cleanup = window.electronAPI.onNavigateTo(handleNavigate);
      return cleanup;
    }
    return undefined;
  }, [isElectron, handleNotificationClick]);

  useEffect(() => {
    const meetingDetector = window.electronAPI?.meetingDetector;
    if (!isElectron || !meetingDetector) return;
    // Sync stored preference to main process on startup
    meetingDetector.setEnabled(localStorage.getItem(MEETING_DETECTION_ENABLED_KEY) !== 'false');
    const cleanup = meetingDetector.onStartRecordingFromMeeting(() => {
      sendRecordingEvent({ type: 'requestAutoStart' });
    });
    window.electronAPI?.ipcSend?.('recording:renderer-ready');
    return cleanup;
  }, [isElectron]);

  // Handle stop signal from the floating recording pill's Stop button
  useEffect(() => {
    const meetingDetector = window.electronAPI?.meetingDetector;
    if (!isElectron || !meetingDetector) return;
    return meetingDetector.onStopRecordingFromMeeting(() => {
      sendRecordingEvent({ type: 'requestStop' });
    });
  }, [isElectron]);

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onRecordingSystemSuspend) return;
    return window.electronAPI.onRecordingSystemSuspend(stopRecordingForTeardown);
  }, [isElectron]);

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onRecordingStopForTeardown) return;
    return window.electronAPI.onRecordingStopForTeardown(stopRecordingForNavigation);
  }, [isElectron]);

  // Same states useCallJoinOrInitiate treats as "in a call"; `initiating` lands
  // before the mic is enabled, so main knows the upcoming activation is ours.
  const isInXyneCall = useSelector(
    roomActor,
    s =>
      s.matches('initiating') ||
      s.matches('joining') ||
      s.matches('connecting') ||
      s.matches('connected'),
  );
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI?.ipcSend?.('call:state-changed', isInXyneCall);
  }, [isElectron, isInXyneCall]);

  const recordingStatus = useRecordingStore(ctx => ctx.status);
  const recordingStartTime = useRecordingStore(ctx => ctx.startTime);
  const recordingPauseStartedAt = useRecordingStore(ctx => ctx.pauseStartedAt);
  const recordingAccumulatedPausedMs = useRecordingStore(ctx => ctx.accumulatedPausedMs);
  const lastRecordingStateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isElectron) return;
    const isActive = recordingStatus === 'recording' || recordingStatus === 'paused';
    const state = {
      active: isActive,
      // Sent before the mic is enabled, so the meeting detector can tell our own
      // recording from a meeting worth offering to record.
      starting: recordingStatus === 'starting',
      startTime: recordingStartTime ?? undefined,
      paused: recordingStatus === 'paused',
      pauseStartedAt: recordingPauseStartedAt,
      accumulatedPausedMs: recordingAccumulatedPausedMs,
    };
    const stateKey = JSON.stringify(state);
    if (stateKey !== lastRecordingStateRef.current) {
      window.electronAPI?.ipcSend?.('recording:state-changed', state);
      if (!isActive) {
        window.electronAPI?.ipcSend?.('recording-pill:recording-stopped', true);
      }
    }
    lastRecordingStateRef.current = stateKey;
  }, [
    isElectron,
    recordingStatus,
    recordingStartTime,
    recordingPauseStartedAt,
    recordingAccumulatedPausedMs,
  ]);

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onRecordingResumeRequest) return;
    return window.electronAPI.onRecordingResumeRequest(() => {
      sendRecordingEvent({ type: 'resumeRecording' });
    });
  }, [isElectron]);

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onRecordingPauseRequest) return;
    return window.electronAPI.onRecordingPauseRequest(() => {
      sendRecordingEvent({ type: 'pauseRecording' });
    });
  }, [isElectron]);

  const handleNotificationRef = useRef(handleNotification);
  const notificationReceivedListenerRef = useRef((n: NotificationData): void =>
    handleNotificationRef.current(n),
  );
  const runClientCommand = useDeferredClientCommand();
  const runClientCommandRef = useRef(runClientCommand);
  useEffect(() => {
    runClientCommandRef.current = runClientCommand;
  }, [runClientCommand]);
  const clientCommandListenerRef = useRef((command: ClientCommand): void => {
    runClientCommandRef.current(command);
  });

  useEffect(() => {
    handleNotificationRef.current = handleNotification;
  }, [handleNotification]);

  useEffect(() => {
    if (user && !isConnectedRef.current) {
      void hydrateDynamicHeaders();
      websocketService
        .connect()
        .then(() => {
          isConnectedRef.current = true;

          // Set up notification listeners after connection is established
          websocketService.on('notification_received', notificationReceivedListenerRef.current);
          websocketService.on('client_command', clientCommandListenerRef.current);

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
        websocketService.removeListener(
          'notification_received',
          notificationReceivedListenerRef.current,
        );
        websocketService.removeListener('client_command', clientCommandListenerRef.current);
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
