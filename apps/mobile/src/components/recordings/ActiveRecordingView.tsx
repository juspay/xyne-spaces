// ---------------------------------------------------------------------------
// ActiveRecordingView
// Scrollable live-transcript panel shown while recording is in progress.
// ---------------------------------------------------------------------------

import { type ReactElement, useEffect, useMemo, useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import type { TranscriptEntry } from '@/src/types/recordings';
import { getSpeakerColor, getInitials } from '@/src/utils/recordingUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupedTranscript {
  speaker: string;
  entries: TranscriptEntry[];
}

interface ActiveRecordingViewProps {
  transcripts: TranscriptEntry[];
  isMicMuted: boolean;
}

// ---------------------------------------------------------------------------
// Listening indicator — three animated bars
// ---------------------------------------------------------------------------

function ListeningIndicator(): ReactElement {
  const bar1 = useSharedValue(0.4);
  const bar2 = useSharedValue(0.7);
  const bar3 = useSharedValue(0.5);

  useEffect(() => {
    bar1.value = withRepeat(
      withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    bar2.value = withRepeat(
      withTiming(1, { duration: 400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    bar3.value = withRepeat(
      withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [bar1, bar2, bar3]);

  const style1 = useAnimatedStyle(() => ({ transform: [{ scaleY: bar1.value }] }));
  const style2 = useAnimatedStyle(() => ({ transform: [{ scaleY: bar2.value }] }));
  const style3 = useAnimatedStyle(() => ({ transform: [{ scaleY: bar3.value }] }));

  const barBase = 'bg-indigo-500 w-1 rounded-full mx-0.5';

  return (
    <View className='flex-row items-center justify-center gap-1 h-6'>
      <Animated.View className={barBase} style={[{ height: 20 }, style1]} />
      <Animated.View className={barBase} style={[{ height: 20 }, style2]} />
      <Animated.View className={barBase} style={[{ height: 20 }, style3]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ActiveRecordingView({
  transcripts,
  isMicMuted,
}: ActiveRecordingViewProps): ReactElement {
  const scrollRef = useRef<ScrollView>(null);
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;

  // Auto-scroll to the bottom on new transcript entries
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcripts.length]);

  // Group consecutive entries by the same speaker
  const groupedTranscripts = useMemo<GroupedTranscript[]>(() => {
    const groups: GroupedTranscript[] = [];
    let currentGroup: GroupedTranscript | null = null;

    for (const entry of transcripts) {
      if (!currentGroup || currentGroup.speaker !== entry.speaker) {
        currentGroup = { speaker: entry.speaker, entries: [entry] };
        groups.push(currentGroup);
      } else {
        currentGroup.entries.push(entry);
      }
    }

    return groups;
  }, [transcripts]);

  return (
    <View className='flex-1'>
      {transcripts.length === 0 ? (
        /* Empty / listening state */
        <View className='flex-1 items-center justify-center gap-3 pb-4'>
          {!isMicMuted && <ListeningIndicator />}
          <Text className='text-sm' style={{ color: mutedColor }}>
            {isMicMuted ? 'Mic muted…' : 'Listening…'}
          </Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, gap: 12 }}
        >
          {groupedTranscripts.map((group, groupIndex) => {
            const color = getSpeakerColor(group.speaker);
            const initials = getInitials(group.speaker);

            return (
              <View key={groupIndex} className='flex-row gap-2'>
                {/* Speaker avatar */}
                <View
                  className='size-8 rounded-full items-center justify-center flex-shrink-0 mt-0.5'
                  style={{ backgroundColor: `${color}30` }}
                >
                  <Text className='text-xs font-semibold' style={{ color }}>
                    {initials}
                  </Text>
                </View>

                {/* Speaker name + text bubbles */}
                <View className='flex-1 gap-1'>
                  <Text className='text-xs font-semibold' style={{ color }}>
                    {group.speaker}
                  </Text>
                  {group.entries.map(entry => (
                    <Text
                      key={entry.id}
                      className='text-sm leading-5'
                      style={{ color: foregroundColor }}
                    >
                      {entry.text}
                    </Text>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
