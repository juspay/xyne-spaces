import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bot,
  Check,
  Link2,
  MessageSquare,
  SwitchCamera,
  UserPlus,
  Users,
} from 'lucide-react-native';

import { haptics } from '@/src/utils/haptics';
import { resolveAiControlTone } from '../callAiControl.utils';
import { CallSheetBackdrop } from '../CallSheetBackdrop';
import { callSheetStyles } from '../callSheet.styles';
import { callColors, withAlpha } from '../callTheme';
import { AUDIO_OUTPUT_LABELS, type AudioOutputType } from '../callStage.utils';
import { AI_AGENT_DISPLAY_NAME } from '../callIdentity';
import type { AudioOutputController } from '../hooks/useAudioOutput';
import { BluetoothIcon, EarpieceIcon, HeadphonesIcon, SpeakerIcon } from '../CallControls/icons';

interface CallMoreSheetProps {
  isVisible: boolean;
  onClose: () => void;
  isCameraEnabled: boolean;
  participantCount: number;
  audio: AudioOutputController;
  onAddPeople: () => void;
  /** Minimises the call and opens its conversation — omit when the call has none. */
  onOpenChat?: (() => void) | undefined;
  onShareLink?: (() => void) | undefined;
  onOpenParticipants: () => void;
  onFlipCamera: () => void;
  /** Xyne Automatic — omit `onToggleAI` to hide the tile entirely. */
  isAIAssistantEnabled?: boolean;
  aiController?: { id: string; name: string } | null;
  pendingControlRequest?: { requesterId: string; requesterName: string } | null;
  localParticipantId?: string | null;
  onToggleAI?: (() => void) | undefined;
  onRequestControl?: (() => void) | undefined;
}

const SPEAKER_ICONS: Record<
  AudioOutputType,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  speaker: SpeakerIcon,
  earpiece: EarpieceIcon,
  bluetooth: BluetoothIcon,
  headset: HeadphonesIcon,
};

/** Ordering of the in-app audio list, most common first. */
const AUDIO_ORDER: readonly AudioOutputType[] = ['speaker', 'earpiece', 'bluetooth', 'headset'];

/** Distinct accents for a tile whose "on" state isn't the generic blue — Xyne Automatic uses its
 * own purple (you're using it) / amber (someone else is) to match its meaning everywhere else. */
type ActionTileTone = 'active' | 'ai' | 'aiControlled';

const TILE_TONE_STYLES: Record<ActionTileTone, { tile: object; icon: object }> = {
  active: {
    tile: { backgroundColor: withAlpha(callColors.active, 0.16) },
    icon: { backgroundColor: callColors.active },
  },
  ai: {
    tile: { backgroundColor: withAlpha(callColors.ai, 0.16) },
    icon: { backgroundColor: callColors.ai },
  },
  aiControlled: {
    tile: { backgroundColor: withAlpha(callColors.aiControlled, 0.16) },
    icon: { backgroundColor: callColors.aiControlled },
  },
};

function ActionTile({
  label,
  hint,
  active = false,
  tone = 'active',
  badge = false,
  onPress,
  children,
}: {
  label: string;
  hint?: string | undefined;
  active?: boolean;
  tone?: ActionTileTone;
  /** Small notification dot — someone else took Xyne Automatic and hasn't been asked yet. */
  badge?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const toneStyles = TILE_TONE_STYLES[tone];
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={() => {
        void haptics.buttonTap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.tile,
        active && toneStyles.tile,
        pressed && styles.tilePressed,
      ]}
    >
      <View style={[styles.tileIcon, active && toneStyles.icon]}>
        {children}
        {badge ? <View style={styles.tileBadge} /> : null}
      </View>
      <Text style={styles.tileLabel} numberOfLines={1} maxFontSizeMultiplier={1.15}>
        {label}
      </Text>
      {hint ? (
        <Text style={styles.tileHint} numberOfLines={1} maxFontSizeMultiplier={1.15}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function CallMoreSheet({
  isVisible,
  onClose,
  isCameraEnabled,
  participantCount,
  audio,
  onAddPeople,
  onOpenChat,
  onShareLink,
  onOpenParticipants,
  onFlipCamera,
  isAIAssistantEnabled = false,
  aiController,
  pendingControlRequest,
  localParticipantId,
  onToggleAI,
  onRequestControl,
}: CallMoreSheetProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheet>(null);
  const { refresh, usesSystemPicker } = audio;

  const {
    tone: aiTone,
    hint: aiHint,
    isControlledByOther,
    showBadge: aiBadge,
  } = resolveAiControlTone({
    isAIAssistantEnabled,
    localParticipantId,
    aiController,
    pendingControlRequest,
  });
  const handleAiPress = useCallback((): void => {
    if (isControlledByOther && onRequestControl) onRequestControl();
    else onToggleAI?.();
  }, [isControlledByOther, onRequestControl, onToggleAI]);

  useEffect(() => {
    if (isVisible) {
      sheetRef.current?.expand();
      void refresh();
    } else {
      sheetRef.current?.close();
    }
  }, [isVisible, refresh]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <CallSheetBackdrop {...props} isOpen={isVisible} opacity={0.55} />
    ),
    [isVisible],
  );

  const handleChange = useCallback(
    (index: number): void => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  /** Closes the sheet, then runs the action (optionally after the close animation). */
  const run = useCallback(
    (action: () => void, delayMs = 0): void => {
      onClose();
      if (delayMs > 0) setTimeout(action, delayMs);
      else action();
    },
    [onClose],
  );

  const listedOutputs = AUDIO_ORDER.filter(type => audio.outputs.includes(type));

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      enableDynamicSizing
      enablePanDownToClose
      onChange={handleChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={callSheetStyles.surface}
      handleIndicatorStyle={callSheetStyles.handle}
    >
      <BottomSheetView
        style={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}
      >
        <Text style={styles.title}>More options</Text>

        <View style={styles.grid}>
          {onToggleAI ? (
            <ActionTile
              label={AI_AGENT_DISPLAY_NAME}
              hint={aiHint}
              active={aiTone !== null}
              tone={aiTone ?? 'ai'}
              badge={aiBadge}
              onPress={() => run(handleAiPress)}
            >
              <Bot size={22} color={aiTone ? callColors.onColor : callColors.textPrimary} />
            </ActionTile>
          ) : null}

          <ActionTile label='Add people' onPress={() => run(onAddPeople)}>
            <UserPlus size={22} color={callColors.textPrimary} />
          </ActionTile>

          {onOpenChat ? (
            <ActionTile label='Chat' onPress={() => run(onOpenChat)}>
              <MessageSquare size={22} color={callColors.textPrimary} />
            </ActionTile>
          ) : null}

          {onShareLink ? (
            // The iOS share sheet can't present until this sheet has finished dismissing.
            <ActionTile label='Share link' onPress={() => run(onShareLink, 300)}>
              <Link2 size={22} color={callColors.textPrimary} />
            </ActionTile>
          ) : null}

          <ActionTile
            label='Participants'
            hint={`${participantCount} in call`}
            onPress={() => run(onOpenParticipants)}
          >
            <Users size={22} color={callColors.textPrimary} />
          </ActionTile>

          {isCameraEnabled ? (
            <ActionTile label='Flip camera' onPress={() => run(onFlipCamera)}>
              <SwitchCamera size={22} color={callColors.textPrimary} />
            </ActionTile>
          ) : null}

          {usesSystemPicker ? (
            <ActionTile
              label='Other devices'
              hint='Bluetooth, AirPlay…'
              onPress={() => run(() => void audio.showSystemPicker(), 300)}
            >
              <SpeakerIcon size={22} color={callColors.textPrimary} />
            </ActionTile>
          ) : null}
        </View>

        {listedOutputs.length > 0 ? (
          <View style={styles.audioSection}>
            <Text style={styles.sectionTitle}>Audio output</Text>
            <View style={styles.audioList}>
              {listedOutputs.map((type, index) => {
                const Icon = SPEAKER_ICONS[type];
                const selected = audio.active === type;
                return (
                  <Pressable
                    key={type}
                    accessibilityRole='radio'
                    accessibilityState={{ selected }}
                    onPress={() => {
                      void haptics.selection();
                      void audio.select(type);
                    }}
                    style={({ pressed }) => [
                      styles.audioRow,
                      index > 0 && styles.audioRowDivider,
                      pressed && styles.tilePressed,
                    ]}
                  >
                    <Icon size={20} color={selected ? callColors.active : callColors.textPrimary} />
                    <Text
                      style={[styles.audioLabel, selected && styles.audioLabelSelected]}
                      maxFontSizeMultiplier={1.15}
                    >
                      {AUDIO_OUTPUT_LABELS[type]}
                    </Text>
                    {selected ? <Check size={18} color={callColors.active} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  title: {
    color: callColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 14,
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: '31.4%',
    minHeight: 96,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: callColors.surfaceRaised,
  },
  tilePressed: {
    opacity: 0.7,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 8,
  },
  tileBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: callColors.danger,
    borderWidth: 2,
    borderColor: callColors.surfaceRaised,
  },
  tileLabel: {
    color: callColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  tileHint: {
    color: callColors.textMuted,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  audioSection: {
    marginTop: 20,
  },
  sectionTitle: {
    color: callColors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  audioList: {
    borderRadius: 18,
    backgroundColor: callColors.surfaceRaised,
    overflow: 'hidden',
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  audioRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: callColors.hairline,
  },
  audioLabel: {
    flex: 1,
    color: callColors.textPrimary,
    fontSize: 15,
    fontWeight: '500',
  },
  audioLabelSelected: {
    color: callColors.active,
    fontWeight: '600',
  },
});
