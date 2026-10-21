import { memo, useCallback, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { BookOpen, RefreshCw } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

import {
  CONNECTION_STATE_COPY,
  CONNECTION_STATE_ORDER,
  LIVE_SYNC_EXPLAINER,
  LIVE_SYNC_GUIDE_ID,
  LIVE_SYNC_TITLE,
  describeConnectionState,
} from './connection-status-copy';

export type ConnectionStatusSheetProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** `useConnectionState().name` from Zero. */
  stateName: string;
  /** Zero's reason string when it provides one (disconnected / error / closed). */
  reason?: string | undefined;
  onRefresh: () => void;
};

/**
 * Two levels of indent: the header, the instruction line and the legend
 * heading sit at the outer edge; the rows inside the legend card are inset,
 * reading as the sub-items of that heading.
 */
const OUTER_INSET = 2;
const CARD_TEXT_INSET = 16;

const Dot = ({ color, size = 10 }: { color: string; size?: number }): ReactElement => (
  <View
    className='rounded-full'
    style={{ width: size, height: size, backgroundColor: color }}
    accessible={false}
  />
);

/**
 * Explains the live-sync indicator, top to bottom: where you are (header),
 * what to do about it (one line, only when there is something to do), the
 * Refresh action, and what each colour means with the current one marked.
 * Opened by tapping the dot in the app header.
 */
export const ConnectionStatusSheet = memo(function ConnectionStatusSheet({
  isOpen,
  onOpenChange,
  stateName,
  reason,
  onRefresh,
}: ConnectionStatusSheetProps): ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { accentBg, accentFg, accentText } = useBubbleAccent();
  const border = useCSSVariable('--color-border') as string;
  const cardBg = useCSSVariable('--color-card') as string;

  const current = describeConnectionState(stateName);
  const needsAttention = current.tone !== 'good';
  const showReason = Boolean(reason) && needsAttention;

  const close = useCallback((): void => onOpenChange(false), [onOpenChange]);

  const handleRefresh = useCallback((): void => {
    void haptics.buttonTap();
    onRefresh();
    close();
  }, [close, onRefresh]);

  const handleOpenGuide = useCallback((): void => {
    void haptics.buttonTap();
    close();
    router.push({
      pathname: '/(protected)/guide/[guideId]',
      params: { guideId: LIVE_SYNC_GUIDE_ID },
    } as Href);
  }, [close, router]);

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      mode='dynamic'
      backdropOpacity={0.42}
    >
      <BottomSheetScrollView
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}
      >
        <View className='px-4 pb-2 pt-1'>
          <View className='flex-row items-center gap-3' style={{ paddingLeft: OUTER_INSET }}>
            <Dot color={current.dotColor} size={14} />
            <Text className='flex-1 text-[18px] font-semibold text-foreground'>
              {LIVE_SYNC_TITLE}
            </Text>
            <View
              className='rounded-full px-2.5 py-1'
              style={{ borderWidth: 1, borderColor: border }}
              accessibilityRole='text'
              accessibilityLabel={`Status: ${current.label}`}
            >
              <Text className='text-[12px] font-semibold text-foreground'>{current.label}</Text>
            </View>
          </View>

          {needsAttention ? (
            <View className='mt-3' style={{ paddingLeft: OUTER_INSET }}>
              <Text className='text-[15px] leading-[22px] text-foreground'>{current.whatToDo}</Text>
              {showReason ? (
                <Text
                  className='mt-1 text-[12px] leading-4 text-secondary-foreground'
                  numberOfLines={3}
                >
                  Details: {reason}
                </Text>
              ) : null}
            </View>
          ) : null}

          {current.canRefresh ? (
            <Pressable
              onPress={handleRefresh}
              accessibilityRole='button'
              accessibilityLabel='Refresh'
              className='mt-4 h-12 flex-row items-center justify-center gap-2 rounded-xl active:opacity-80'
              style={{ backgroundColor: accentBg }}
            >
              <RefreshCw size={17} color={accentFg} strokeWidth={2.4} />
              <Text className='text-[16px] font-semibold' style={{ color: accentFg }}>
                Refresh
              </Text>
            </Pressable>
          ) : null}

          <Text
            className='mb-1 mt-5 text-[12px] font-bold uppercase tracking-wider text-secondary-foreground'
            style={{ marginLeft: OUTER_INSET }}
          >
            What the colours mean
          </Text>
          <Text
            className='mb-2.5 text-[13px] leading-[18px] text-secondary-foreground'
            style={{ marginLeft: OUTER_INSET }}
          >
            {LIVE_SYNC_EXPLAINER}
          </Text>
          <View className='overflow-hidden rounded-2xl' style={{ backgroundColor: cardBg }}>
            {CONNECTION_STATE_ORDER.map((name, index) => {
              const entry = CONNECTION_STATE_COPY[name];
              const isCurrent = entry.name === current.name;
              return (
                <View
                  key={name}
                  className='flex-row items-start gap-3'
                  style={{
                    paddingHorizontal: CARD_TEXT_INSET,
                    paddingVertical: 10,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderTopColor: border,
                  }}
                  accessibilityLabel={`${entry.label}: ${entry.meaning}`}
                >
                  <View style={{ marginTop: 6 }}>
                    <Dot color={entry.dotColor} />
                  </View>
                  <View className='flex-1'>
                    <Text
                      className='text-[15px] text-foreground'
                      style={isCurrent ? { fontWeight: '700' } : undefined}
                    >
                      {entry.label}
                      {isCurrent ? '  ·  now' : ''}
                    </Text>
                    <Text className='mt-0.5 text-[13px] leading-[18px] text-secondary-foreground'>
                      {entry.meaning}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          <Pressable
            onPress={handleOpenGuide}
            accessibilityRole='button'
            accessibilityLabel='Read the guide about staying in sync'
            className='mt-4 h-12 flex-row items-center justify-center gap-2 rounded-xl active:opacity-80'
            style={{ borderWidth: 1, borderColor: border }}
          >
            <BookOpen size={17} color={accentText} strokeWidth={2.2} />
            <Text className='text-[15px] font-semibold' style={{ color: accentText }}>
              Read the guide
            </Text>
          </Pressable>
        </View>
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
});
