import React, { memo } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptics } from '@/src/utils/haptics';
import { GlassPanel } from '../GlassPanel';
import { useOptimisticToggle } from '../hooks/useOptimisticToggle';
import { callColors, callLayout, callMotion, callRadii } from '../callTheme';
import { AUDIO_OUTPUT_LABELS, type AudioOutputType } from '../callStage.utils';
import {
  BluetoothIcon,
  EarpieceIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  MoreHorizontalIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  SpeakerIcon,
  VideoIcon,
  VideoOffIcon,
} from './icons';

/** Keeps the bar a compact pill on tablets instead of stretching edge to edge. */
const MAX_BAR_WIDTH = 440;

type ControlTone = 'neutral' | 'inverted' | 'active' | 'danger';

const TONES: Record<ControlTone, { bg: string; fg: string }> = {
  neutral: { bg: 'rgba(255,255,255,0.14)', fg: callColors.onColor },
  inverted: { bg: callColors.inverted, fg: callColors.onInverted },
  active: { bg: callColors.active, fg: callColors.onActive },
  danger: { bg: callColors.danger, fg: callColors.onColor },
};

interface ControlButtonProps {
  label: string;
  tone: ControlTone;
  size: number;
  onPress: () => void;
  badge?: boolean;
  children: (color: string) => React.ReactNode;
}

/** Round control with a springy press and a colour that eases between states. */
function ControlButton({
  label,
  tone,
  size,
  onPress,
  badge = false,
  children,
}: ControlButtonProps): React.ReactElement {
  const scale = useSharedValue(1);
  const { bg, fg } = TONES[tone];

  const style = useAnimatedStyle(() => ({
    backgroundColor: withTiming(bg, {
      duration: callMotion.controlToneMs,
      easing: Easing.out(Easing.quad),
    }),
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.9, callMotion.pressSpring);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, callMotion.pressSpring);
      }}
    >
      <Animated.View
        style={[styles.button, { width: size, height: size, borderRadius: size / 2 }, style]}
      >
        {children(fg)}
        {badge ? <View style={styles.badge} /> : null}
      </Animated.View>
    </Pressable>
  );
}

function AudioRouteIcon({
  route,
  color,
}: {
  route: AudioOutputType | null;
  color: string;
}): React.ReactElement {
  switch (route) {
    case 'earpiece':
      return <EarpieceIcon size={24} color={color} />;
    case 'bluetooth':
      return <BluetoothIcon size={24} color={color} />;
    case 'headset':
      return <HeadphonesIcon size={24} color={color} />;
    case 'speaker':
    default:
      return <SpeakerIcon size={24} color={color} />;
  }
}

interface CallControlsProps {
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  /** Current audio route, or null when the platform can't tell (iOS). */
  audioRoute: AudioOutputType | null;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onAudioPress: () => void;
  onOpenMore: () => void;
  onDisconnect: () => void;
}

/**
 * The floating control bar: audio route, camera, mic, screen share, more, end.
 * White fill means "off", blue means "on"; red is for mute and for ending the call — the two
 * states WhatsApp also calls out in red, since an unintentional mute is worth noticing.
 * Xyne Automatic lives in the More sheet (`CallMoreSheet`), not here.
 */
export const CallControls = memo(function CallControls({
  isMicEnabled,
  isCameraEnabled,
  isScreenShareEnabled,
  audioRoute,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onAudioPress,
  onOpenMore,
  onDisconnect,
}: CallControlsProps): React.ReactElement {
  const { width } = useWindowDimensions();

  // Mic, camera and screen share each round-trip through LiveKit (and, for mic/camera, the
  // native bridge) before `isMicEnabled` etc. actually flip — waiting for that reads as a
  // sluggish button. Show the tap's result immediately; each hook reconciles with the real
  // prop the moment it catches up, or self-corrects if the toggle is ever denied.
  const mic = useOptimisticToggle(isMicEnabled, onToggleMic);
  const camera = useOptimisticToggle(isCameraEnabled, onToggleCamera);
  const screenShare = useOptimisticToggle(isScreenShareEnabled, onToggleScreenShare);

  const buttonCount = 6;
  const barWidth = Math.min(width - callLayout.controlBarMargin * 2, MAX_BAR_WIDTH);
  const gap = 8;
  const padding = 10;
  const size = Math.max(
    36,
    Math.min(54, Math.floor((barWidth - padding * 2 - gap * (buttonCount - 1)) / buttonCount)),
  );

  return (
    <View style={styles.wrap} pointerEvents='box-none'>
      <View style={[styles.bar, { padding, gap, borderRadius: callRadii.bar }]}>
        {/* Glass sits behind the buttons (not around them) so it never distorts touch targets. */}
        <GlassPanel decorative style={[StyleSheet.absoluteFill, { borderRadius: callRadii.bar }]} />
        <ControlButton
          label={audioRoute ? `Audio output: ${AUDIO_OUTPUT_LABELS[audioRoute]}` : 'Audio output'}
          tone={audioRoute === 'speaker' ? 'active' : 'neutral'}
          size={size}
          onPress={() => {
            void haptics.buttonTap();
            onAudioPress();
          }}
        >
          {color => <AudioRouteIcon route={audioRoute} color={color} />}
        </ControlButton>

        <ControlButton
          label={camera.value ? 'Turn camera off' : 'Turn camera on'}
          tone={camera.value ? 'neutral' : 'inverted'}
          size={size}
          onPress={() => {
            void (camera.value ? haptics.toggleOff() : haptics.toggleOn());
            camera.toggle();
          }}
        >
          {color =>
            camera.value ? (
              <VideoIcon size={24} color={color} />
            ) : (
              <VideoOffIcon size={24} color={color} />
            )
          }
        </ControlButton>

        <ControlButton
          label={mic.value ? 'Mute microphone' : 'Unmute microphone'}
          tone={mic.value ? 'neutral' : 'danger'}
          size={size}
          onPress={() => {
            void (mic.value ? haptics.toggleOff() : haptics.toggleOn());
            mic.toggle();
          }}
        >
          {color =>
            mic.value ? <MicIcon size={24} color={color} /> : <MicOffIcon size={24} color={color} />
          }
        </ControlButton>

        <ControlButton
          label={screenShare.value ? 'Stop sharing screen' : 'Share screen'}
          tone={screenShare.value ? 'active' : 'neutral'}
          size={size}
          onPress={() => {
            void haptics.buttonTap();
            screenShare.toggle();
          }}
        >
          {color =>
            screenShare.value ? (
              <ScreenShareOffIcon size={24} color={color} />
            ) : (
              <ScreenShareIcon size={24} color={color} />
            )
          }
        </ControlButton>

        <ControlButton
          label='More options'
          tone='neutral'
          size={size}
          onPress={() => {
            void haptics.buttonTap();
            onOpenMore();
          }}
        >
          {color => <MoreHorizontalIcon size={24} color={color} />}
        </ControlButton>

        <ControlButton
          label='End call'
          tone='danger'
          size={size}
          onPress={() => {
            // Ending a call is destructive and immediate — no confirmation step.
            void haptics.warning();
            onDisconnect();
          }}
        >
          {color => <PhoneOffIcon size={24} color={color} />}
        </ControlButton>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: callLayout.controlBarMargin,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    maxWidth: MAX_BAR_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: callColors.hairline,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: callColors.danger,
    borderWidth: 2,
    borderColor: callColors.stage,
  },
});
