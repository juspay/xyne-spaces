import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Link2, UserPlus } from 'lucide-react-native';

import { haptics } from '@/src/utils/haptics';
import { GlassPanel } from '../GlassPanel';
import { callColors } from '../callTheme';

interface WaitingForOthersProps {
  /** Distance from the bottom edge, so the card clears the control bar. */
  bottomOffset: number;
  onShareLink?: (() => void) | undefined;
  onAddPeople: () => void;
}

/** Shown when you're alone in a call nobody has been invited to (link / instant calls). */
export function WaitingForOthers({
  bottomOffset,
  onShareLink,
  onAddPeople,
}: WaitingForOthersProps): React.ReactElement {
  return (
    <Animated.View
      entering={FadeInDown.duration(300)}
      exiting={FadeOutDown.duration(200)}
      style={[styles.wrap, { bottom: bottomOffset }]}
      pointerEvents='box-none'
    >
      <GlassPanel style={styles.card}>
        <Text style={styles.title} maxFontSizeMultiplier={1.15}>
          You&apos;re the only one here
        </Text>
        <Text style={styles.subtitle} maxFontSizeMultiplier={1.15}>
          Invite people to get the call started.
        </Text>
        <View style={styles.actions}>
          {onShareLink ? (
            <Pressable
              accessibilityRole='button'
              onPress={() => {
                void haptics.buttonTap();
                onShareLink();
              }}
              style={({ pressed }) => [styles.action, styles.primary, pressed && styles.pressed]}
            >
              <Link2 size={17} color={callColors.onActive} />
              <Text style={styles.primaryText} maxFontSizeMultiplier={1.15}>
                Share link
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole='button'
            onPress={() => {
              void haptics.buttonTap();
              onAddPeople();
            }}
            style={({ pressed }) => [styles.action, styles.secondary, pressed && styles.pressed]}
          >
            <UserPlus size={17} color={callColors.textPrimary} />
            <Text style={styles.secondaryText} maxFontSizeMultiplier={1.15}>
              Add people
            </Text>
          </Pressable>
        </View>
      </GlassPanel>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderRadius: 22,
  },
  title: {
    color: callColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    color: callColors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 22,
  },
  primary: {
    backgroundColor: callColors.active,
  },
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  pressed: {
    opacity: 0.8,
  },
  primaryText: {
    color: callColors.onActive,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryText: {
    color: callColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
});
