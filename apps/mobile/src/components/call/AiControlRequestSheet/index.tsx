import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bot, Check, XCircle } from 'lucide-react-native';

import { haptics } from '@/src/utils/haptics';
import { callSheetStyles } from '../callSheet.styles';
import { callColors, withAlpha } from '../callTheme';

interface AiControlRequestSheetProps {
  isOpen: boolean;
  requesterName: string;
  onApprove: () => void;
  onDeny: () => void;
}

/** Shown to whoever controls Xyne Automatic when someone else asks to take over. */
export function AiControlRequestSheet({
  isOpen,
  requesterName,
  onApprove,
  onDeny,
}: AiControlRequestSheetProps): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  if (!isOpen) return null;

  return (
    <Modal
      transparent
      visible={isOpen}
      animationType='slide'
      statusBarTranslucent
      onRequestClose={onDeny}
    >
      <Pressable style={styles.overlay} onPress={onDeny}>
        <Pressable
          style={[
            callSheetStyles.surface,
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
          onPress={(e: { stopPropagation: () => void }) => e.stopPropagation()}
        >
          <View style={[callSheetStyles.handle, styles.handle]} />

          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Bot size={28} color='#c084fc' />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>AI control request</Text>
              <Text style={styles.subtitle}>Xyne Automatic</Text>
            </View>
          </View>

          <Text style={styles.message}>
            <Text style={styles.highlight}>{requesterName}</Text> is requesting control of the AI
            assistant.
          </Text>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole='button'
              onPress={() => {
                void haptics.success();
                onApprove();
              }}
              style={({ pressed }) => [styles.button, styles.approve, pressed && styles.pressed]}
            >
              <Check size={20} color={callColors.onColor} />
              <Text style={styles.buttonText}>Approve</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              onPress={() => {
                void haptics.buttonTap();
                onDeny();
              }}
              style={({ pressed }) => [styles.button, styles.deny, pressed && styles.pressed]}
            >
              <XCircle size={20} color={callColors.onColor} />
              <Text style={styles.buttonText}>Deny</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  handle: {
    alignSelf: 'center',
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  headerText: {
    flex: 1,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(callColors.ai, 0.22),
  },
  title: {
    color: callColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: callColors.textMuted,
    fontSize: 14,
    marginTop: 2,
  },
  message: {
    color: callColors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
  },
  highlight: {
    color: callColors.textPrimary,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
  },
  approve: {
    backgroundColor: '#16A34A',
  },
  deny: {
    backgroundColor: callColors.surfaceRaised,
  },
  pressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: callColors.onColor,
    fontSize: 16,
    fontWeight: '600',
  },
});
