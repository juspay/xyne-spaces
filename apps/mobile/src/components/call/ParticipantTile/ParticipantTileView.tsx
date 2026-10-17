/**
 * Presentational participant tile. Knows nothing about LiveKit: the connected wrapper feeds it
 * plain values plus the already-rendered video element, which keeps every visual state
 * (voice hero, card, PiP, filmstrip, ringing, screen share) renderable in isolation.
 */
import React, { memo, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { MicOff, MonitorUp, PhoneCall, PhoneOff, SignalLow, WifiOff } from 'lucide-react-native';

import { callColors, withAlpha } from '../callTheme';
import { CallBackdrop } from '../CallBackdrop';
import { GlassPanel } from '../GlassPanel';
import { ParticipantAvatar } from '../ParticipantAvatar';
import type { StageInsets, TileVariant } from '../callStage.utils';
import { getRingStatusLabel, type RingStatusValue } from '../callRoster.utils';

export type ConnectionLevel = 'good' | 'poor' | 'lost';

interface ParticipantTileViewProps {
  variant: TileVariant;
  /** Target frame size — used to size the avatar, not to lay the tile out. */
  width: number;
  height: number;
  identity: string;
  name: string;
  isLocal: boolean;
  isAgent: boolean;
  pictureUri?: string | null | undefined;
  isMicMuted: boolean;
  isSpeaking: boolean;
  /** Rendered `VideoTrack` when there is live video; the avatar shows otherwise. */
  video?: React.ReactNode;
  isScreenShare?: boolean;
  aiControllerName?: string | null | undefined;
  connection?: ConnectionLevel;
  /** Set for an invitee who is being rung and has not joined (dashboard's RingingParticipantTile). */
  ringStatus?: RingStatusValue | null | undefined;
  /** Keeps hero overlays clear of the header / control bar. */
  insets?: StageInsets;
  onStopScreenShare?: (() => void) | undefined;
}

const NO_INSETS: StageInsets = { top: 0, bottom: 0 };

function avatarSizeFor(variant: TileVariant, width: number, height: number): number {
  switch (variant) {
    case 'hero':
      return Math.round(Math.min(148, Math.max(104, Math.min(width, height) * 0.36)));
    case 'pip':
      return 44;
    case 'strip':
      return 32;
    case 'card':
    default:
      return Math.round(Math.min(104, Math.max(44, Math.min(width, height) * 0.4)));
  }
}

/** Border + glow that fades in while the person is speaking. */
function SpeakingBorder({
  active,
  radius,
}: {
  active: boolean;
  radius: number;
}): React.ReactElement {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, { duration: 160 });
  }, [active, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents='none'
      style={[styles.speakingBorder, { borderRadius: radius }, style]}
    />
  );
}

/** Photo-derived (or identity-coloured) wash behind a tile that has no video. */
function TileBackdrop({
  identity,
  pictureUri,
  isAgent,
}: {
  identity: string;
  pictureUri?: string | null | undefined;
  isAgent: boolean;
}): React.ReactElement {
  if (isAgent) {
    return (
      <LinearGradient
        colors={[callColors.aiWash, callColors.surface]}
        style={StyleSheet.absoluteFill}
        pointerEvents='none'
      />
    );
  }
  return <CallBackdrop variant='tile' tintIdentity={identity} pictureUri={pictureUri} />;
}

function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
}): React.ReactElement {
  if (tone === 'neutral') return <GlassPanel style={styles.pill}>{children}</GlassPanel>;
  return (
    <View style={[styles.pill, tone === 'warning' ? styles.pillWarning : styles.pillDanger]}>
      {children}
    </View>
  );
}

export const ParticipantTileView = memo(function ParticipantTileView({
  variant,
  width,
  height,
  identity,
  name,
  isLocal,
  isAgent,
  pictureUri,
  isMicMuted,
  isSpeaking,
  video,
  isScreenShare = false,
  aiControllerName,
  connection = 'good',
  ringStatus = null,
  insets = NO_INSETS,
  onStopScreenShare,
}: ParticipantTileViewProps): React.ReactElement {
  const isHero = variant === 'hero';
  const isPip = variant === 'pip';
  const isStrip = variant === 'strip';
  const isCompact = isPip || isStrip;
  const hasVideo = !!video;
  const speaking = isSpeaking && !isMicMuted;
  const avatarSize = avatarSizeFor(variant, width, height);
  const label = isLocal ? 'You' : name;

  // "You're sharing your screen" replaces the video so the phone doesn't mirror itself.
  if (isScreenShare && isLocal) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: callColors.surface }]}>
        <View style={styles.presentingIcon}>
          <MonitorUp size={26} color={callColors.onActive} />
        </View>
        <Text style={styles.presentingTitle}>You&apos;re sharing your screen</Text>
        <Text style={styles.presentingSubtitle}>Everyone in the call can see it</Text>
        {onStopScreenShare ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Stop sharing screen'
            onPress={onStopScreenShare}
            style={({ pressed }) => [styles.stopButton, pressed && styles.stopButtonPressed]}
          >
            <Text style={styles.stopButtonText}>Stop sharing</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.fill, !isHero && { backgroundColor: callColors.surface }]}>
      {hasVideo ? (
        video
      ) : isHero ? null : (
        <TileBackdrop identity={identity} pictureUri={pictureUri} isAgent={isAgent} />
      )}

      {/* No-video presence: avatar (with ripple when speaking / ringing). */}
      {!hasVideo && !isScreenShare ? (
        <View
          pointerEvents='none'
          style={[
            styles.fill,
            styles.centered,
            isHero && { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
        >
          <ParticipantAvatar
            identity={identity}
            name={name}
            pictureUri={pictureUri}
            isAgent={isAgent}
            size={avatarSize}
            ringing={ringStatus === 'ringing'}
            speaking={speaking}
          />
          {ringStatus && !isCompact && !isHero ? (
            <View style={styles.pendingRow}>
              {ringStatus === 'busy' ? (
                <PhoneOff size={13} color={callColors.warning} />
              ) : (
                <PhoneCall size={13} color={callColors.textSecondary} />
              )}
              <Text style={styles.pendingText} maxFontSizeMultiplier={1.2}>
                {getRingStatusLabel(ringStatus)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Speaking highlight (cards / PiP / strip — the hero pulses its avatar instead). */}
      {!isHero && !isScreenShare ? (
        <SpeakingBorder active={speaking} radius={variant === 'card' ? 16 : isPip ? 18 : 12} />
      ) : null}

      {/* Presenting label */}
      {isScreenShare ? (
        <GlassPanel style={[styles.chip, styles.topLeft]}>
          <MonitorUp size={13} color={callColors.active} />
          <Text style={styles.chipText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {name} is presenting
          </Text>
        </GlassPanel>
      ) : null}

      {/* Name chip */}
      {!isHero && !isPip && !isScreenShare ? (
        <GlassPanel style={[styles.chip, isStrip ? styles.chipStrip : styles.bottomLeft]}>
          {isMicMuted ? <MicOff size={isStrip ? 10 : 13} color={callColors.onColor} /> : null}
          {connection !== 'good' && !isStrip ? (
            connection === 'lost' ? (
              <WifiOff size={13} color={callColors.danger} />
            ) : (
              <SignalLow size={13} color={callColors.warning} />
            )
          ) : null}
          <Text
            style={[styles.chipText, isStrip && styles.chipTextStrip]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
          >
            {label}
          </Text>
        </GlassPanel>
      ) : null}

      {/* PiP keeps only a compact mute badge */}
      {isPip && isMicMuted ? (
        <GlassPanel style={styles.pipMute}>
          <MicOff size={12} color={callColors.onColor} />
        </GlassPanel>
      ) : null}

      {/* Hero status pills sit just above the control bar */}
      {isHero && !isLocal && (isMicMuted || connection !== 'good') ? (
        <View style={[styles.heroPills, { bottom: insets.bottom + 10 }]} pointerEvents='none'>
          {isMicMuted ? (
            <StatusPill>
              <MicOff size={13} color={callColors.onColor} />
              <Text style={styles.chipText} maxFontSizeMultiplier={1.2}>
                {name} is muted
              </Text>
            </StatusPill>
          ) : null}
          {connection !== 'good' ? (
            <StatusPill tone={connection === 'lost' ? 'danger' : 'warning'}>
              {connection === 'lost' ? (
                <WifiOff size={13} color={callColors.onColor} />
              ) : (
                <SignalLow size={13} color={callColors.onColor} />
              )}
              <Text style={styles.chipText} maxFontSizeMultiplier={1.2}>
                {connection === 'lost' ? 'Connection lost' : 'Poor connection'}
              </Text>
            </StatusPill>
          ) : null}
        </View>
      ) : null}

      {/* AI controller badge */}
      {isAgent && aiControllerName ? (
        <View
          style={[
            styles.aiBadge,
            isCompact && styles.aiBadgeCompact,
            isHero && { top: insets.top + 10 },
          ]}
        >
          <Text
            style={[styles.aiBadgeText, isCompact && styles.aiBadgeTextCompact]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
          >
            {aiControllerName}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakingBorder: {
    ...StyleSheet.absoluteFill,
    borderWidth: 3,
    borderColor: callColors.speaking,
    shadowColor: callColors.speaking,
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '86%',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
  },
  chipText: {
    color: callColors.onColor,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  chipStrip: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 4,
    maxWidth: '100%',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    justifyContent: 'center',
  },
  chipTextStrip: {
    fontSize: 10,
  },
  topLeft: {
    position: 'absolute',
    top: 10,
    left: 10,
  },
  bottomLeft: {
    position: 'absolute',
    bottom: 10,
    left: 10,
  },
  pipMute: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    padding: 5,
    borderRadius: 12,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  pendingText: {
    color: callColors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  heroPills: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
  },
  pillWarning: {
    backgroundColor: 'rgba(180,110,10,0.85)',
  },
  pillDanger: {
    backgroundColor: 'rgba(200,40,35,0.85)',
  },
  aiBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    maxWidth: 140,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: withAlpha(callColors.ai, 0.88),
  },
  aiBadgeCompact: {
    top: 4,
    right: 4,
    maxWidth: 72,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
  },
  aiBadgeText: {
    color: callColors.onColor,
    fontSize: 11,
    fontWeight: '600',
  },
  aiBadgeTextCompact: {
    fontSize: 8,
  },
  presentingIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: callColors.active,
    marginBottom: 14,
  },
  presentingTitle: {
    color: callColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  presentingSubtitle: {
    color: callColors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  stopButton: {
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: callColors.active,
  },
  stopButtonPressed: {
    opacity: 0.8,
  },
  stopButtonText: {
    color: callColors.onActive,
    fontSize: 14,
    fontWeight: '700',
  },
});
