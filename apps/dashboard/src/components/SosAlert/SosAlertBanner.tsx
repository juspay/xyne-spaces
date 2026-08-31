import { logger, Event as LogEvent } from '../../utils/logger';
import React, { useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthContext } from '../../providers/AuthProvider';
import { API_BASE_URL } from '../../config';
import { queryClient } from '../../services/clients/queryClient';
import { websocketService } from '../../services/clients/socketClient';
import { sendSosAlertEvent, useSosAlertStore, type SosAlert } from '../../stores/sosAlertStore';
import { confirmRecordingInterrupt } from '../Recording/RecordingInterruptGuard/RecordingInterruptGuard';

// Singleton audio element (same leak-avoidance pattern as NotificationHandler).
let sirenAudio: HTMLAudioElement | null = null;

export const playSosSiren = (): void => {
  try {
    if (!sirenAudio) {
      sirenAudio = new Audio('/sounds/sos-alert.wav');
      sirenAudio.volume = 1.0;
    }
    sirenAudio.loop = true;
    if (sirenAudio.paused) {
      sirenAudio.currentTime = 0;
      sirenAudio.play().catch(() => {
        // Autoplay blocked until the user interacts with the page — the toast
        // is still visible, and any click lets subsequent plays through.
      });
    }
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('[SosAlert] Error playing siren:'),
      error: error,
    });
  }
};

export const stopSosSiren = (): void => {
  try {
    if (sirenAudio) {
      sirenAudio.loop = false;
      sirenAudio.pause();
      sirenAudio.currentTime = 0;
    }
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('[SosAlert] Error stopping siren:'),
      error: error,
    });
  }
};

/**
 * Renders SOS alerts
 */
export const SosAlertBanner: React.FC = () => {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const { workspaceId: activeWorkspaceId } = useParams<{ workspaceId?: string }>();
  const alerts = useSosAlertStore(ctx => ctx.alerts);

  // Toast ids currently shown, so re-renders don't duplicate toasts.
  const shownRef = useRef<Set<string>>(new Set());

  // Reset store on user change (logout/switch) to prevent alerts leaking across accounts,
  // then hydrate the new user's persisted alerts.
  useEffect(() => {
    if (user?.id) {
      sendSosAlertEvent({ type: 'hydrate', userId: user.id });
    } else {
      sendSosAlertEvent({ type: 'reset' });
      stopSosSiren();
    }
  }, [user?.id]);

  // Stop siren on unmount (e.g. logout tears down AppRoot while alerts remain).
  useEffect(() => {
    return (): void => {
      stopSosSiren();
    };
  }, []);

  // Listen for acknowledgments from other devices/tabs of the same user.
  useEffect(() => {
    let mounted = true;
    const handler = ({ alertId }: { alertId: string }): void => {
      sendSosAlertEvent({ type: 'acknowledgeAlert', id: alertId });
    };
    websocketService
      .connect()
      .then(() => {
        if (!mounted) return;
        websocketService.on('sos_alert_acknowledged', handler);
      })
      .catch((err: unknown) => {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String(
            '[SosAlert] WebSocket connect failed — cross-device SOS ack sync unavailable',
          ),
          context: [err],
        });
      });
    return () => {
      mounted = false;
      websocketService.removeListener('sos_alert_acknowledged', handler);
    };
  }, []);

  // Ask the server which stored alerts were already dismissed on another device.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current || alerts.length === 0) return;
    const alertIds = alerts.map(a => a.id);
    websocketService
      .connect()
      .then(() => {
        if (syncedRef.current) return;
        const socket = websocketService.getSocket();
        if (!socket) return;
        syncedRef.current = true;
        socket.emit('sos_alerts_sync', { alertIds });
      })
      .catch(() => undefined); // connect failure logged by the ack-listener effect
  }, [alerts]);

  const acknowledge = useCallback((id: string): void => {
    sendSosAlertEvent({ type: 'acknowledgeAlert', id });
    const socket = websocketService.getSocket();
    if (socket) {
      socket.emit('sos_alert_acknowledged', { alertId: id });
    }
  }, []);

  // Mirrors NotificationHandler's cross-workspace click handling: switching
  // workspace flips the session cookie, so it needs a hard reload.
  const view = useCallback(
    async (alert: SosAlert): Promise<void> => {
      const resolvedUrl =
        alert.actionUrl || (alert.workspaceId ? `/${alert.workspaceId}/chat` : '/chat');

      if (alert.workspaceId && alert.workspaceId !== activeWorkspaceId) {
        if (!(await confirmRecordingInterrupt('workspaceSwitch'))) return;
        try {
          await axios.post(
            `${API_BASE_URL}/auth/switch-workspace`,
            { workspaceId: alert.workspaceId },
            { withCredentials: true },
          );
          acknowledge(alert.id);
          queryClient.clear();
          window.location.href = resolvedUrl;
          return;
        } catch (error) {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[SosAlert] Workspace switch failed:'),
            error: error,
          });
          toast.error('Failed to switch workspace. Please try again.');
          return;
        }
      }

      acknowledge(alert.id);
      void navigate(resolvedUrl);
    },
    [acknowledge, activeWorkspaceId, navigate],
  );

  useEffect(() => {
    // Show a persistent toast for every alert not yet on screen.
    for (const alert of alerts) {
      if (shownRef.current.has(alert.id)) continue;
      shownRef.current.add(alert.id);
      playSosSiren();

      toast.error(alert.workspaceName ? `${alert.workspaceName} — ${alert.title}` : alert.title, {
        id: alert.id,
        description: alert.message,
        duration: Infinity, // stays until the user closes or clicks it
        action: {
          label: 'View',
          onClick: (): void => {
            void view(alert);
          },
        },
        // Fires when the user closes the toast (X) — that's the acknowledgment.
        onDismiss: (): void => {
          acknowledge(alert.id);
        },
      });
    }

    // Stop siren when all alerts are gone.
    if (alerts.length === 0) {
      stopSosSiren();
    }

    // Drop toasts for alerts acknowledged elsewhere (e.g. View click).
    for (const shownId of shownRef.current) {
      if (!alerts.some(a => a.id === shownId)) {
        shownRef.current.delete(shownId);
        toast.dismiss(shownId);
      }
    }
  }, [alerts, view, acknowledge]);

  return null;
};
