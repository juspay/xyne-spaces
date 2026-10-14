import { Siren } from 'lucide-react-native';
import { type ReactElement, useCallback, useEffect, useMemo } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import notifee from 'react-native-notify-kit';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { useAuth } from '@/src/contexts/AuthContext';
import { getString } from '@/src/services/localStorage';
import { websocketService } from '@/src/services/websocketService';

import { dismissSosAlert } from './actionsApi';
import { extractSosAlertFromTrayData } from './parser';
import {
  acknowledgeSosAlertInStore,
  addSosAlert,
  getSosAlertSnapshot,
  hydrateSosAlerts,
  resetSosAlerts,
  useSosAlerts,
} from './store';
import { startSosSiren, stopSosSiren } from './siren';
import type { SosAlert } from './types';

const DISPLAYED_ALERT_RECOVERY_DELAYS_MS = [0, 250, 1_000] as const;

async function recoverDisplayedSosAlerts(expectedUserId: string | null): Promise<void> {
  if (!expectedUserId) return;

  try {
    const displayed = await notifee.getDisplayedNotifications();
    if (expectedUserId !== getStoredUserId()) return;
    for (const { notification } of displayed) {
      const alert = extractSosAlertFromTrayData(
        notification?.data as Record<string, unknown> | undefined,
      );
      if (alert?.ownerUserId === expectedUserId) addSosAlert(alert);
    }
  } catch {
    // Displayed-alert recovery failed; best-effort.
  }
}

function getStoredUserId(): string | null {
  if (getString('lotus_auth_token_signed_out') === 'signed_out') return null;
  return getString('@lotus_user_id')?.trim() || getString('xyne-global:userId')?.trim() || null;
}

export function SosAlertHost(): ReactElement {
  const { user, isLoading, isSignedIn } = useAuth();
  const alerts = useSosAlerts(state => state.alerts);
  const insets = useSafeAreaInsets();

  const sheetBackground = useCSSVariable('--color-bottomsheet-bg') as string;
  const cardBackground = useCSSVariable('--color-card') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const bodyColor = useCSSVariable('--color-secondary-foreground') as string;
  const mutedColor = useCSSVariable('--color-bottomsheet-text-muted') as string;
  const criticalColor = useCSSVariable('--color-ticket-priority-critical') as string;
  const criticalSurface = useCSSVariable('--color-ticket-label-red-bg') as string;
  const criticalLabel = useCSSVariable('--color-ticket-label-red-text') as string;
  const accentSurface = useCSSVariable('--color-accent') as string;

  const activeAlert = alerts[0] ?? null;
  const pendingIds = useMemo(() => alerts.map(alert => alert.id), [alerts]);

  useEffect(() => {
    if (user?.user_id) {
      hydrateSosAlerts(user.user_id);
      return;
    }

    if (!isLoading && !isSignedIn) {
      resetSosAlerts();
      void stopSosSiren();
    }
  }, [isLoading, isSignedIn, user?.user_id]);

  useEffect(() => {
    if (alerts.length > 0) {
      void startSosSiren();
      return;
    }
    void stopSosSiren();
  }, [alerts.length]);

  useEffect(() => {
    return (): void => {
      void stopSosSiren();
    };
  }, []);

  useEffect(() => {
    const handler = ({ alertId }: { alertId: string }): void => {
      acknowledgeSosAlertInStore(alertId);
    };

    let mounted = true;
    void websocketService
      .connect()
      .then((): void => {
        if (mounted) websocketService.on('sos_alert_acknowledged', handler);
      })
      .catch(() => {});

    return (): void => {
      mounted = false;
      websocketService.removeListener('sos_alert_acknowledged', handler);
    };
  }, []);

  useEffect(() => {
    if (pendingIds.length === 0) return;

    void websocketService
      .connect()
      .then((): void => {
        websocketService.emit('sos_alerts_sync', { alertIds: pendingIds.slice(0, 50) });
      })
      .catch(() => {});
  }, [pendingIds]);

  useEffect(() => {
    // Reading Firebase/Notifee initial-notification state here can consume a
    // normal message tap before the navigation owner sees it. SOS banners are
    // ongoing until acknowledgement, so recover them from the non-consuming
    // displayed-notifications API instead.
    const retryTimers = DISPLAYED_ALERT_RECOVERY_DELAYS_MS.map(delayMs =>
      setTimeout((): void => {
        void recoverDisplayedSosAlerts(user?.user_id ?? null);
      }, delayMs),
    );

    const appStateSubscription = AppState.addEventListener('change', (nextState): void => {
      if (nextState === 'active') {
        void recoverDisplayedSosAlerts(user?.user_id ?? null);
      }
    });

    return (): void => {
      retryTimers.forEach(clearTimeout);
      appStateSubscription.remove();
    };
  }, [user?.user_id]);

  const onAcknowledge = useCallback(async (alert: SosAlert): Promise<void> => {
    await dismissSosAlert(alert);
  }, []);

  const onAcknowledgeActive = useCallback(() => {
    if (!activeAlert) return;
    void onAcknowledge(activeAlert);
  }, [activeAlert, onAcknowledge]);

  return (
    <Modal
      animationType='fade'
      hardwareAccelerated
      navigationBarTranslucent
      onRequestClose={() => {
        // SOS alerts can only be closed by explicit acknowledgement.
      }}
      presentationStyle='overFullScreen'
      statusBarTranslucent
      transparent
      visible={activeAlert !== null}
    >
      {activeAlert ? (
        <View style={styles.backdrop}>
          <View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: sheetBackground,
                borderColor,
                paddingBottom: Math.max(insets.bottom, 24),
              },
            ]}
          >
            <View style={styles.headerRow}>
              <View style={[styles.iconWrap, { backgroundColor: criticalSurface }]}>
                <Siren color={criticalColor} size={22} strokeWidth={2.25} />
              </View>
              <View style={styles.headerCopy}>
                <Text style={[styles.kicker, { color: criticalLabel }]}>SOS ALERT</Text>
                <Text style={[styles.headerTitle, { color: foregroundColor }]}>
                  Immediate attention required
                </Text>
              </View>
            </View>

            <ScrollView bounces={false} style={styles.messageScroll}>
              <View
                style={[
                  styles.messageCard,
                  {
                    backgroundColor: cardBackground,
                    borderColor,
                  },
                ]}
              >
                <Text style={[styles.alertTitle, { color: foregroundColor }]}>
                  {activeAlert.title}
                </Text>
                {activeAlert.body ? (
                  <Text style={[styles.alertBody, { color: bodyColor }]}>{activeAlert.body}</Text>
                ) : null}
              </View>

              {alerts.length > 1 ? (
                <View style={[styles.queuePill, { backgroundColor: accentSurface }]}>
                  <Text style={[styles.queueText, { color: bodyColor }]}>
                    {alerts.length - 1} more active alert
                    {alerts.length - 1 === 1 ? '' : 's'} queued
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Acknowledge SOS alert'
              onPress={onAcknowledgeActive}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: criticalColor, opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Text style={styles.primaryText}>Acknowledge</Text>
            </Pressable>

            <Text style={[styles.footerHint, { color: mutedColor }]}>
              Acknowledge to stop the alert and dismiss the notification.
            </Text>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

export function hasActiveSosAlerts(): boolean {
  return getSosAlertSnapshot().alerts.length > 0;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  sheet: {
    maxHeight: '90%',
    paddingHorizontal: 20,
    paddingTop: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  messageCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 14,
  },
  messageScroll: {
    flexShrink: 1,
  },
  alertTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  alertBody: {
    fontSize: 15,
    lineHeight: 22,
  },
  queuePill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
  },
  queueText: {
    fontSize: 12,
    fontWeight: '600',
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  primaryText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  footerHint: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
