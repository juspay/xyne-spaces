import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { BottomSheetFlatList, type BottomSheetFlatListMethods } from '@gorhom/bottom-sheet';
import { Languages, MessageSquareText, Share2 } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { haptics } from '@/src/utils/haptics';
import { cn } from '@/src/utils/cn';

import {
  ORIGINAL_TRANSCRIPT_LANGUAGE,
  TRANSCRIPT_LANGUAGES,
  useTranscriptTranslation,
} from '../hooks/use-transcript-translation';
import {
  findIndexByTimeSeconds,
  findTranscriptTargetIndex,
  parseTranscript,
  type TranscriptLine,
} from '../utils/call-detail-format';

export interface TranscriptTarget {
  segment?: number | null;
  timestampSeconds?: number | null;
  /** Highlight the line as a decision / action marker instead of a citation. */
  tone?: 'citation' | 'marker';
  nonce: number;
}

const SPEAKER_COLORS = ['#2563EB', '#059669', '#7C3AED', '#DB2777', '#D97706', '#0891B2'] as const;

function speakerColor(speaker: string, order: ReadonlyMap<string, number>): string {
  return SPEAKER_COLORS[(order.get(speaker) ?? 0) % SPEAKER_COLORS.length] ?? SPEAKER_COLORS[0];
}

export function TranscriptSheet({
  isOpen,
  onClose,
  callExternalId,
  title,
  target,
  markedMomentSeconds,
  canOpenThread,
  onOpenThread,
}: {
  isOpen: boolean;
  onClose: () => void;
  callExternalId: string | undefined;
  title: string;
  target: TranscriptTarget | null;
  markedMomentSeconds: readonly number[];
  canOpenThread: boolean;
  onOpenThread: () => void;
}): ReactElement {
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const [language, setLanguage] = useState(ORIGINAL_TRANSCRIPT_LANGUAGE);
  const transcript = useTranscriptTranslation(callExternalId, language, isOpen);
  const listRef = useRef<BottomSheetFlatListMethods>(null);

  const lines = useMemo(() => parseTranscript(transcript.text ?? ''), [transcript.text]);
  const speakerOrder = useMemo(() => {
    const order = new Map<string, number>();
    for (const line of lines) {
      if (line.speaker && !order.has(line.speaker)) order.set(line.speaker, order.size);
    }
    return order;
  }, [lines]);
  const momentIndices = useMemo(() => {
    const set = new Set<number>();
    for (const seconds of markedMomentSeconds) {
      const index = findIndexByTimeSeconds(lines, seconds);
      if (index >= 0) set.add(index);
    }
    return set;
  }, [lines, markedMomentSeconds]);

  const targetIndex = useMemo(
    () => (target ? findTranscriptTargetIndex(lines, target) : -1),
    [lines, target],
  );

  // Scroll the cited line into view once the transcript (and sheet) are up.
  useEffect(() => {
    if (!isOpen || targetIndex < 0) return;
    const timeout = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: targetIndex, animated: true, viewPosition: 0.3 });
    }, 350);
    return (): void => clearTimeout(timeout);
  }, [isOpen, targetIndex, target?.nonce]);

  const handleShare = useCallback((): void => {
    if (!transcript.text) return;
    void haptics.buttonTap();
    void Share.share({ message: transcript.text, title: `Transcript – ${title}` });
  }, [transcript.text, title]);

  const renderItem = useCallback(
    ({ item, index }: { item: TranscriptLine; index: number }): ReactElement => {
      const isTarget = index === targetIndex;
      const previous = index > 0 ? lines[index - 1] : undefined;
      const continues = !!item.speaker && previous?.speaker === item.speaker;
      return (
        <View>
          {momentIndices.has(index) ? (
            <View className='flex-row items-center gap-2 px-5 pt-3 pb-1'>
              <View className='h-px flex-1' style={{ backgroundColor: '#EF444466' }} />
              <Text
                className='text-[11px] font-semibold uppercase tracking-wide'
                style={{ color: '#EF4444' }}
              >
                Marked moment
              </Text>
              <View className='h-px flex-1' style={{ backgroundColor: '#EF444466' }} />
            </View>
          ) : null}
          <View
            className={cn('mx-3 rounded-xl px-2 py-1.5', !continues && 'mt-2')}
            style={
              isTarget
                ? {
                    backgroundColor:
                      target?.tone === 'marker' ? 'rgba(234,179,8,0.16)' : 'rgba(127,127,127,0.14)',
                  }
                : undefined
            }
          >
            {item.speaker && !continues ? (
              <View className='flex-row items-baseline gap-2 mb-0.5'>
                <Text
                  className='text-[13px] font-semibold'
                  style={{ color: speakerColor(item.speaker, speakerOrder) }}
                >
                  {item.speaker}
                </Text>
                {item.timestamp ? (
                  <Text
                    className='text-[11.5px] text-secondary-foreground'
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {item.timestamp}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Text selectable className='text-[14.5px] leading-[21px] text-foreground'>
              {item.text ?? item.raw}
            </Text>
          </View>
        </View>
      );
    },
    [lines, momentIndices, speakerOrder, target?.tone, targetIndex],
  );

  const body = transcript.isLoading ? (
    <View className='flex-1 items-center justify-center py-16 gap-3'>
      <ActivityIndicator />
      <Text className='text-sm text-secondary-foreground'>Loading transcript…</Text>
    </View>
  ) : transcript.error && !transcript.text ? (
    <View className='flex-1 items-center justify-center px-8 py-16 gap-3'>
      <Text className='text-sm text-center text-secondary-foreground'>{transcript.error}</Text>
      <Pressable
        onPress={transcript.retry}
        className='rounded-full bg-secondary px-4 h-9 justify-center active:opacity-70'
      >
        <Text className='text-[13px] font-medium text-foreground'>Try again</Text>
      </Pressable>
    </View>
  ) : lines.length === 0 ? (
    <View className='flex-1 items-center justify-center py-16'>
      <Text className='text-sm text-secondary-foreground'>
        No transcript available for this call.
      </Text>
    </View>
  ) : (
    <BottomSheetFlatList
      ref={listRef}
      data={lines}
      keyExtractor={(_item: TranscriptLine, index: number) => String(index)}
      renderItem={renderItem}
      contentContainerStyle={{ paddingBottom: 48 }}
      onScrollToIndexFailed={({
        index,
        averageItemLength,
      }: {
        index: number;
        averageItemLength: number;
      }) => {
        listRef.current?.scrollToOffset({
          offset: Math.max(0, index * averageItemLength - 120),
          animated: false,
        });
        setTimeout(
          () => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 }),
          120,
        );
      }}
    />
  );

  return (
    <AppBottomSheet isOpen={isOpen} onOpenChange={open => !open && onClose()} mode='fullscreen'>
      <View className='flex-1'>
        <View className='px-5 pt-1 pb-2 flex-row items-start gap-3'>
          <View className='flex-1 min-w-0'>
            <Text className='text-lg font-semibold text-foreground'>Transcript</Text>
            <Text className='text-[13px] text-secondary-foreground' numberOfLines={1}>
              {title}
            </Text>
          </View>
          {canOpenThread ? (
            <Pressable
              onPress={onOpenThread}
              hitSlop={6}
              accessibilityRole='button'
              accessibilityLabel='Open the call thread'
              className='h-9 w-9 items-center justify-center rounded-full bg-secondary active:opacity-70'
            >
              <MessageSquareText size={17} color={foreground} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleShare}
            disabled={!transcript.text}
            hitSlop={6}
            accessibilityRole='button'
            accessibilityLabel='Share transcript'
            className='h-9 w-9 items-center justify-center rounded-full bg-secondary active:opacity-70'
            style={{ opacity: transcript.text ? 1 : 0.4 }}
          >
            <Share2 size={16} color={foreground} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className='grow-0'
          contentContainerStyle={{
            paddingHorizontal: 16,
            gap: 6,
            paddingBottom: 10,
            alignItems: 'center',
          }}
        >
          <Languages size={15} color={muted} />
          {TRANSCRIPT_LANGUAGES.map(option => {
            const isActive = option.code === language;
            return (
              <Pressable
                key={option.code}
                onPress={(): void => {
                  void haptics.selection();
                  setLanguage(option.code);
                }}
                accessibilityRole='button'
                accessibilityState={{ selected: isActive }}
                className={cn(
                  'h-8 rounded-full px-3 justify-center border',
                  isActive ? 'bg-secondary border-border' : 'border-transparent',
                )}
              >
                <Text
                  className={cn(
                    'text-[12.5px] font-medium',
                    isActive ? 'text-foreground' : 'text-secondary-foreground',
                  )}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
          {transcript.isTranslating ? <ActivityIndicator size='small' color={muted} /> : null}
        </ScrollView>
        {transcript.error && transcript.text ? (
          <Pressable
            onPress={transcript.retry}
            className='mx-5 mb-2 rounded-lg bg-secondary px-3 py-2'
          >
            <Text className='text-[12.5px] text-secondary-foreground'>{`${transcript.error} Tap to retry.`}</Text>
          </Pressable>
        ) : null}
        <View className='h-px bg-border' />
        {body}
      </View>
    </AppBottomSheet>
  );
}
