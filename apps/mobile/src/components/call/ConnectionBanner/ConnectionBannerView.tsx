import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { SignalLow, WifiOff } from 'lucide-react-native';

import { callColors, callLayout } from '../callTheme';

export type BannerKind = 'reconnecting' | 'disconnected' | 'poor';

interface BannerViewProps {
  kind: BannerKind | null;
  topInset: number;
}

const COPY: Record<BannerKind, string> = {
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected from the call',
  poor: 'Your connection is unstable',
};

/** Slides in under the header when the network is degraded; renders nothing when healthy. */
export function ConnectionBannerView({
  kind,
  topInset,
}: BannerViewProps): React.ReactElement | null {
  if (!kind) return null;
  const tone =
    kind === 'poor' ? styles.warning : kind === 'reconnecting' ? styles.warning : styles.danger;
  return (
    <View
      pointerEvents='none'
      style={[styles.slot, { top: topInset + callLayout.headerHeight + 4 }]}
    >
      <Animated.View
        key={kind}
        entering={FadeInUp.duration(260)}
        exiting={FadeOutUp.duration(200)}
        style={[styles.pill, tone]}
      >
        {kind === 'reconnecting' ? (
          <ActivityIndicator size='small' color={callColors.onColor} />
        ) : kind === 'poor' ? (
          <SignalLow size={16} color={callColors.onColor} />
        ) : (
          <WifiOff size={16} color={callColors.onColor} />
        )}
        <Text style={styles.text} maxFontSizeMultiplier={1.15}>
          {COPY[kind]}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  warning: {
    backgroundColor: 'rgba(202,138,4,0.96)',
  },
  danger: {
    backgroundColor: 'rgba(220,54,46,0.96)',
  },
  text: {
    color: callColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
});
