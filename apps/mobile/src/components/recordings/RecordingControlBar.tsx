// ---------------------------------------------------------------------------
// RecordingControlBar
// Sticky bottom control bar for the recordings screen.
// Shows animated waveform bars + elapsed timer while recording, and
// start / pause / resume / stop buttons.
// ---------------------------------------------------------------------------

import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Mic, Pause, Play, Square } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { formatElapsedTime } from '@/src/utils/recordingUtils';

// ---------------------------------------------------------------------------
// WaveformBars — purely decorative animated bars
// ---------------------------------------------------------------------------

function WaveformBars(): ReactElement {
  const heights = [
    useSharedValue(0.3),
    useSharedValue(0.6),
    useSharedValue(0.45),
    useSharedValue(0.8),
    useSharedValue(0.35),
  ];

  useEffect(() => {
    heights.forEach((h, i) => {
      h.value = withRepeat(
        withTiming(0.9 + Math.random() * 0.1, {
          duration: 300 + i * 80,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View className='flex-row items-center gap-0.5'>
      {heights.map((h, i) => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const style = useAnimatedStyle(() => ({ transform: [{ scaleY: h.value }] }));
        return (
          <Animated.View
            key={i}
            className='bg-emerald-500 w-0.5 rounded-full'
            style={[{ height: 18 }, style]}
          />
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// RecordingControlBar
// ---------------------------------------------------------------------------

export interface RecordingControlBarProps {
  isRecording: boolean;
  isMicMuted: boolean;
  isStarting: boolean;
  startTime: number | null;
  onStart: () => void;
  onStop: () => void;
  onMuteToggle: () => void;
}

export function RecordingControlBar({
  isRecording,
  isMicMuted,
  isStarting,
  startTime,
  onStart,
  onStop,
  onMuteToggle,
}: RecordingControlBarProps): ReactElement {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const insets = useSafeAreaInsets();
  const borderColor = useCSSVariable('--color-border') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;

  // Tick elapsed timer while actively recording (mic may be muted but time still ticks)
  useEffect(() => {
    if (isRecording && startTime) {
      setElapsed(Date.now() - startTime);
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - startTime);
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setElapsed(0);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRecording, startTime]);

  const isActive = isRecording || isStarting;

  return (
    <View
      className='bg-card px-4 py-3 gap-2 mb-2'
      style={{
        borderTopWidth: 1,
        borderTopColor: borderColor,
        paddingBottom: insets.bottom,
      }}
    >
      {/* Controls row */}
      <View className='flex-row items-center justify-between'>
        {/* Left: waveform or muted indicator */}
        <View className='w-16 items-start'>
          {isRecording && !isMicMuted ? <WaveformBars /> : <View />}
        </View>

        {/* Centre: timer + main action buttons */}
        <View className='flex-row items-center gap-3'>
          {isActive && (
            <Text
              className='text-sm font-mono font-semibold tabular-nums'
              style={{ color: foregroundColor }}
            >
              {formatElapsedTime(elapsed)}
            </Text>
          )}

          {/* Pause / Resume — shown while recording */}
          {isRecording && (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={isMicMuted ? 'Resume recording' : 'Pause recording'}
              onPress={onMuteToggle}
              className='size-10 rounded-xl items-center justify-center active:opacity-70 bg-muted'
            >
              {isMicMuted ? (
                <Play size={18} color='#6366f1' />
              ) : (
                <Pause size={18} color='#6366f1' />
              )}
            </Pressable>
          )}

          {/* Start / Stop */}
          {isActive ? (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Stop recording'
              onPress={onStop}
              className='size-12 rounded-full bg-red-500 items-center justify-center active:opacity-70'
            >
              <Square size={18} color='white' fill='white' />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Start recording'
              onPress={onStart}
              className='size-12 rounded-full bg-indigo-500 items-center justify-center active:opacity-70'
            >
              <Mic size={20} color='white' />
            </Pressable>
          )}
        </View>

        {/* Right: placeholder to balance layout */}
        <View className='w-16' />
      </View>
    </View>
  );
}
