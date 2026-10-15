import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { PhoneCall, ChevronDown, FileText } from 'lucide-react-native';
import { fetchTranscript, getCachedTranscript } from './utils';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

export interface CallTranscriptCardProps {
  /** External call ID from the message metadata */
  callId: string;
  /** Human-readable title/summary line already shown in the system message */
  callContent: string;
  isExpand?: boolean;
  fullHeight?: boolean;
}

export const CallTranscriptCard = memo(function CallTranscriptCard({
  callId,
  callContent,
  isExpand = false,
  fullHeight = false,
}: CallTranscriptCardProps) {
  const [isExpanded, setIsExpanded] = useState(isExpand);
  const [transcript, setTranscript] = useState<string | null>(
    () => getCachedTranscript(callId) ?? null,
  );
  const [isLoading, setIsLoading] = useState(
    () => isExpand && getCachedTranscript(callId) === undefined,
  );
  const [error, setError] = useState<string | null>(null);

  const { accentText: greenColor, accentSoft } = useBubbleAccent();
  const chevronRotation = useSharedValue(isExpand ? 180 : 0);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  const loadingRef = useRef(false);

  const loadTranscript = useCallback(
    async (force = false) => {
      if (!force) {
        const cached = getCachedTranscript(callId);
        if (cached !== undefined) {
          setTranscript(cached);
          return;
        }
      }
      if (!force && loadingRef.current) return;

      loadingRef.current = true;
      setIsLoading(true);
      setError(null);
      try {
        const text = await fetchTranscript(callId, { force });
        setTranscript(text);
      } catch (err) {
        setError('Could not load transcript. Please try again.');
        console.warn('[CallTranscriptCard] failed to fetch transcript:', err);
      } finally {
        loadingRef.current = false;
        setIsLoading(false);
      }
    },
    [callId],
  );

  useEffect(() => {
    const cached = getCachedTranscript(callId);
    setTranscript(cached ?? null);
    setError(null);

    if (isExpand) {
      setIsExpanded(true);
      if (cached === undefined) {
        void loadTranscript();
      }
    }
  }, [callId, isExpand, loadTranscript]);

  const handleToggle = useCallback(async () => {
    const expanding = !isExpanded;
    setIsExpanded(expanding);
    chevronRotation.value = withTiming(expanding ? 180 : 0, {
      duration: 220,
      easing: Easing.out(Easing.quad),
    });

    if (expanding) {
      await loadTranscript();
    }
  }, [isExpanded, chevronRotation, loadTranscript]);

  return (
    <View className='mx-3 mb-3 rounded-2xl border border-border overflow-hidden'>
      {/* Header */}
      <Pressable
        onPress={handleToggle}
        className='flex-row items-center gap-3 px-3.5 py-3 bg-base-150 active:opacity-80'
      >
        {/* Icon badge */}
        <View
          className='w-8 h-8 rounded-xl items-center justify-center'
          style={{ backgroundColor: accentSoft }}
        >
          <PhoneCall size={15} color={greenColor} />
        </View>

        {/* Text */}
        <View className='flex-1 min-w-0'>
          <Text
            className='text-[13px] font-semibold text-foreground leading-tight'
            numberOfLines={1}
          >
            {callContent || 'Call Recording'}
          </Text>
          <Text className='text-[11px] text-chat-card-foreground-muted mt-0.5'>
            Tap to view transcript
          </Text>
        </View>

        {/* Animated chevron */}
        <Animated.View style={chevronStyle}>
          <ChevronDown size={16} color={greenColor} />
        </Animated.View>
      </Pressable>

      {/* Transcript body */}
      {isExpanded && (
        <View className='bg-chat-card'>
          <View className='h-px bg-border mx-3.5' />

          {isLoading ? (
            <View className='py-8 items-center gap-2.5'>
              <ActivityIndicator size='small' color={greenColor} />
              <Text className='text-xs text-chat-card-foreground-muted'>Loading transcript…</Text>
            </View>
          ) : error ? (
            <View className='px-3.5 py-4 flex-row items-center gap-2'>
              <Text className='text-xs text-red-500 flex-1'>{error}</Text>
              <Pressable
                onPress={() => {
                  setTranscript(null);
                  void loadTranscript(true);
                }}
                className='active:opacity-70'
              >
                <Text className='text-xs font-medium' style={{ color: greenColor }}>
                  Retry
                </Text>
              </Pressable>
            </View>
          ) : transcript ? (
            <View className='px-3.5 pt-3 pb-3.5'>
              {/* Transcript label */}
              <View className='flex-row items-center gap-1.5 mb-2.5'>
                <FileText size={11} color={greenColor} />
                <Text
                  className='text-[11px] font-semibold uppercase tracking-wider'
                  style={{ color: greenColor }}
                >
                  Transcript
                </Text>
              </View>
              <ScrollView
                className={fullHeight ? 'h-[calc(70vh)]' : 'max-h-72'}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                <Text className='text-[13px] leading-[1.7] text-foreground/90' selectable>
                  {transcript}
                </Text>
              </ScrollView>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
});
