import React, { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn } from 'react-native-reanimated';
import { ChevronDown, ChevronRight, SwitchCamera, UserPlus } from 'lucide-react-native';

import { GlassIconButton } from '../GlassIconButton';
import { haptics } from '@/src/utils/haptics';
import { callColors, callLayout, callMotion } from '../callTheme';
import { formatCallDuration, type CallStatus, type StatusTone } from '../callStage.utils';

const TONE_COLOR: Record<StatusTone, string> = {
  neutral: callColors.textSecondary,
  success: callColors.textSecondary,
  warning: callColors.warning,
  danger: callColors.dangerText,
};

/** Ticks on its own so the rest of the call screen never re-renders each second. */
function CallTimerText({ startedAtMs }: { startedAtMs: number }): React.ReactElement {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return (): void => clearInterval(id);
  }, []);
  return (
    <Text style={styles.timer} maxFontSizeMultiplier={1.15}>
      {formatCallDuration(Date.now() - startedAtMs)}
    </Text>
  );
}

interface CallHeaderProps {
  title: string;
  status: CallStatus;
  /** When the conversation started (first other person present); drives the timer. */
  timerStartMs: number | null;
  /** People in the room, shown next to the timer. */
  participantCount: number;
  topInset: number;
  /** Minimise: the call keeps running behind the app. */
  onBack: () => void;
  onOpenParticipants: () => void;
  onAddParticipant?: (() => void) | undefined;
  /** Provided only while the camera is on. */
  onFlipCamera?: (() => void) | undefined;
}

export const CallHeader = memo(function CallHeader({
  title,
  status,
  timerStartMs,
  participantCount,
  topInset,
  onBack,
  onOpenParticipants,
  onAddParticipant,
  onFlipCamera,
}: CallHeaderProps): React.ReactElement {
  const showTimer = status.showTimer && timerStartMs !== null;
  const peopleLabel = participantCount > 2 ? `${participantCount} people` : '';

  return (
    <View style={[styles.root, { paddingTop: topInset }]} pointerEvents='box-none'>
      <LinearGradient
        pointerEvents='none'
        colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']}
        style={[StyleSheet.absoluteFill, { height: topInset + callLayout.headerHeight + 28 }]}
      />
      <View style={styles.row} pointerEvents='box-none'>
        <View style={[styles.side, styles.sideLeft]} pointerEvents='box-none'>
          <GlassIconButton label='Minimize call' onPress={onBack}>
            <ChevronDown size={24} color={callColors.textPrimary} />
          </GlassIconButton>
        </View>

        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Show participants'
          onPress={() => {
            void haptics.buttonTap();
            onOpenParticipants();
          }}
          style={styles.center}
        >
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.15}>
            {title}
          </Text>
          <View style={styles.subtitleRow}>
            {/* Re-keyed on change so the status line fades in instead of swapping abruptly. */}
            <Animated.View
              key={showTimer ? 'timer' : status.text}
              entering={FadeIn.duration(callMotion.fadeMs)}
              style={styles.subtitleInner}
            >
              {showTimer ? (
                <CallTimerText startedAtMs={timerStartMs} />
              ) : (
                <Text
                  style={[styles.status, { color: TONE_COLOR[status.tone] }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.15}
                >
                  {status.text}
                </Text>
              )}
            </Animated.View>
            {showTimer && peopleLabel ? (
              <Text style={styles.people} maxFontSizeMultiplier={1.15}>
                {' · '}
                {peopleLabel}
              </Text>
            ) : null}
            {participantCount > 1 ? (
              <ChevronRight size={14} color={callColors.textMuted} style={styles.chevron} />
            ) : null}
          </View>
        </Pressable>

        <View style={[styles.side, styles.sideRight]} pointerEvents='box-none'>
          {onFlipCamera ? (
            <GlassIconButton label='Flip camera' onPress={onFlipCamera}>
              <SwitchCamera size={21} color={callColors.textPrimary} />
            </GlassIconButton>
          ) : null}
          {onAddParticipant ? (
            <GlassIconButton label='Add people' onPress={onAddParticipant}>
              <UserPlus size={21} color={callColors.textPrimary} />
            </GlassIconButton>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {},
  row: {
    height: callLayout.headerHeight,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  side: {
    width: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sideLeft: {
    justifyContent: 'flex-start',
  },
  sideRight: {
    justifyContent: 'flex-end',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  title: {
    color: callColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    minHeight: 18,
  },
  subtitleInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  status: {
    fontSize: 14,
    fontWeight: '500',
  },
  timer: {
    color: callColors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  people: {
    color: callColors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  chevron: {
    marginLeft: 2,
  },
});
