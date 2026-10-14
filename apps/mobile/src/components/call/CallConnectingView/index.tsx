import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { ChevronDown } from 'lucide-react-native';

import { GlassIconButton } from '../GlassIconButton';
import { CallBackdrop } from '../CallBackdrop';
import { ParticipantAvatar } from '../ParticipantAvatar';
import { useParticipantPicture } from '../hooks/useParticipantPicture';
import { callColors, callLayout, callMotion } from '../callTheme';

interface CallConnectingViewProps {
  title: string;
  /** "Calling…", "Joining…", "Connecting…" */
  statusText: string;
  /** The person on the other end (1:1 calls), for the avatar and backdrop. */
  heroUserId: string | null;
  topInset: number;
  bottomInset: number;
  onBack: () => void;
  /** The call just ended: same backdrop, no spinner. */
  ended?: boolean;
}

/**
 * Shown from the moment a call starts until the room is live: the other person's avatar on the
 * same backdrop the call itself uses, so connecting flows into the call. It never claims anyone
 * is ringing — that only comes from the backend's ring status once you're in the call.
 */
export function CallConnectingView({
  title,
  statusText,
  heroUserId,
  topInset,
  bottomInset,
  onBack,
  ended = false,
}: CallConnectingViewProps): React.ReactElement {
  const identity = heroUserId ?? title;
  const pictureUri = useParticipantPicture(heroUserId ?? '');

  return (
    <Animated.View
      style={StyleSheet.absoluteFill}
      entering={FadeIn.duration(callMotion.chromeMs)}
      exiting={FadeOut.duration(callMotion.fadeMs)}
    >
      <CallBackdrop tintIdentity={identity} pictureUri={pictureUri} />

      <View style={[styles.header, { paddingTop: topInset }]}>
        <View style={styles.backButton}>
          <GlassIconButton label='Minimize call' onPress={onBack}>
            <ChevronDown size={24} color={callColors.textPrimary} />
          </GlassIconButton>
        </View>
      </View>

      <View
        style={[
          styles.center,
          { paddingTop: topInset + callLayout.headerHeight, paddingBottom: bottomInset },
        ]}
      >
        <ParticipantAvatar identity={identity} name={title} pictureUri={pictureUri} size={132} />
        <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={1.15}>
          {title}
        </Text>
        <Animated.Text
          key={statusText}
          entering={FadeIn.duration(callMotion.fadeMs)}
          style={styles.status}
          maxFontSizeMultiplier={1.15}
        >
          {statusText}
        </Animated.Text>
        {/* A spinner, not a ringing pulse: nobody has been reached yet (same as the dashboard). */}
        {ended ? null : (
          <ActivityIndicator size='small' color={callColors.textSecondary} style={styles.spinner} />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingBottom: 12,
    zIndex: 5,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginTop: (callLayout.headerHeight - 40) / 2,
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    color: callColors.textPrimary,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: 36,
  },
  spinner: {
    marginTop: 16,
  },
  status: {
    color: callColors.textSecondary,
    fontSize: 16,
    fontWeight: '500',
    marginTop: 8,
  },
});
