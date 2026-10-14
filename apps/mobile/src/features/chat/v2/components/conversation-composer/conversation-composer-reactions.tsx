import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useCSSVariable } from 'uniwind';

import { reactionsMdToRawReactions } from '@/src/utils/conversationMessageHelpers';
import {
  groupReactionsForPill,
  totalReactionCount,
  type PillEmojiGroup,
  type RawReaction,
} from '@/src/components/chat/message/reactions/reaction-pill.utils';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import Avatar from '@/src/components/ui/avatar';
import { useAuth } from '@/src/contexts/AuthContext';
import { useUsers } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { cn } from '@/src/utils/cn';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import { useConversationComposer } from './conversation-composer-context';
import { DebugBoundary } from './utils/debug-boundary';
import { getConversationReactionsMd } from './utils/getConversationReactionsMd';

const PILL_EMOJI_SIZE = 14;
const MAX_VISIBLE_EMOJIS = 4;
const PILL_HORIZONTAL_PADDING = 12;
const PILL_ITEM_GAP = 6;
const PILL_COUNT_CHARACTER_WIDTH = 8;
const PILL_END_INSET = 8;
const CHIPS_ROW_HEIGHT = 56;

const getVisibleEmojiCount = (availableBubbleWidth: number, total: number): number => {
  if (availableBubbleWidth <= 0) return 1;

  const hasVisibleTotal = total > 1;
  const countWidth = hasVisibleTotal ? String(total).length * PILL_COUNT_CHARACTER_WIDTH : 0;
  const availableForEmojis =
    availableBubbleWidth -
    PILL_END_INSET -
    PILL_HORIZONTAL_PADDING -
    countWidth -
    (hasVisibleTotal ? PILL_ITEM_GAP : 0);
  const count = Math.floor(
    (availableForEmojis + PILL_ITEM_GAP) / (PILL_EMOJI_SIZE + PILL_ITEM_GAP),
  );
  return Math.max(1, Math.min(MAX_VISIBLE_EMOJIS, count));
};

export type ReactionRow = {
  reactionId: string;
  userId: string;
  name: string;
  picture: string;
  emojiName: string;
  createdAt: number;
};

const renderBackdrop = (props: BottomSheetBackdropProps): ReactElement => (
  <BottomSheetBackdrop
    {...props}
    appearsOnIndex={0}
    disappearsOnIndex={-1}
    opacity={0.5}
    pressBehavior='close'
  />
);

type ReactionsBottomSheetProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ReactionRow[];
  groups: PillEmojiGroup[];
  total: number;
  currentUserId?: string | undefined;
  onRemoveReaction: (emojiName: string) => void;
};

export const ReactionsBottomSheet = ({
  isOpen,
  onOpenChange,
  rows,
  groups,
  total,
  currentUserId,
  onRemoveReaction,
}: ReactionsBottomSheetProps): ReactElement => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const background = useCSSVariable('--color-background') as string;
  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;
  const { accentSoft, accentText } = useBubbleAccent();
  const [filterEmoji, setFilterEmoji] = useState<string | null>(null);
  const snapPoints = useMemo(() => ['50%', '80%'], []);

  useEffect(() => {
    if (isOpen) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [isOpen]);

  const handleDismiss = useCallback(() => {
    setFilterEmoji(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const filteredRows = useMemo(() => {
    if (!filterEmoji) return rows;
    return rows.filter(r => r.emojiName === filterEmoji);
  }, [rows, filterEmoji]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      enableDynamicSizing={false}
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: background,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
      }}
      handleIndicatorStyle={{
        backgroundColor: mutedForeground,
        opacity: 0.3,
        width: 100,
        height: 8,
        borderRadius: 999,
      }}
    >
      <View className='min-h-0 flex-1'>
        <Text className='px-4 pt-2 text-base font-semibold text-foreground'>
          {total} {total === 1 ? 'reaction' : 'reactions'}
        </Text>

        <View style={{ height: CHIPS_ROW_HEIGHT }}>
          <BottomSheetScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
            keyboardShouldPersistTaps='handled'
          >
            <Pressable
              onPress={() => setFilterEmoji(null)}
              className={cn(
                'flex-row items-center gap-1 rounded-full border-[0.5px] px-3 py-1.5',
                filterEmoji === null ? '' : 'bg-card border-foreground/15',
              )}
              style={
                filterEmoji === null
                  ? { backgroundColor: accentSoft, borderColor: accentText }
                  : undefined
              }
            >
              <Text
                className={cn(
                  'text-sm',
                  filterEmoji === null ? 'font-bold' : 'text-tab-inactive-text font-semibold',
                )}
                style={filterEmoji === null ? { color: accentText } : undefined}
              >
                All {total}
              </Text>
            </Pressable>

            {groups.map(g => {
              const isActive = filterEmoji === g.emojiName;
              return (
                <Pressable
                  key={g.emojiName}
                  onPress={() =>
                    setFilterEmoji(prev => (prev === g.emojiName ? null : g.emojiName))
                  }
                  className={cn(
                    'flex-row items-center gap-1 rounded-full border-[0.5px] px-3 py-1.5',
                    isActive ? '' : 'bg-card border-foreground/15',
                  )}
                  style={
                    isActive ? { backgroundColor: accentSoft, borderColor: accentText } : undefined
                  }
                >
                  <ReactionEmojiDisplay emojiName={g.emojiName} />
                  <Text
                    className={cn(
                      'text-sm',
                      isActive ? 'font-bold' : 'text-tab-inactive-text font-semibold',
                    )}
                    style={isActive ? { color: accentText } : undefined}
                  >
                    {g.count}
                  </Text>
                </Pressable>
              );
            })}
          </BottomSheetScrollView>
        </View>

        <BottomSheetScrollView
          style={{ flex: 1, minHeight: 0 }}
          contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 32 }}
        >
          {filteredRows.map(item => {
            const isSelf = !!currentUserId && item.userId === currentUserId;
            return (
              <Pressable
                key={item.reactionId}
                onPress={
                  isSelf
                    ? (): void => {
                        onRemoveReaction(item.emojiName);
                        onOpenChange(false);
                      }
                    : undefined
                }
                disabled={!isSelf}
                accessibilityRole={isSelf ? 'button' : undefined}
                accessibilityHint={isSelf ? 'Tap to remove your reaction' : undefined}
                className={cn(
                  'flex-row items-center gap-3 rounded-lg px-2 py-2.5',
                  isSelf && 'active:bg-accent',
                )}
              >
                <Avatar userIds={[item.userId]} size={32} />
                <Text className='flex-1 text-base text-foreground' numberOfLines={1}>
                  {item.name}
                </Text>
                <ReactionEmojiDisplay emojiName={item.emojiName} />
              </Pressable>
            );
          })}
        </BottomSheetScrollView>
      </View>
    </BottomSheetModal>
  );
};

type ReactionsProps = {
  availableBubbleWidth: number;
};

const Reactions = memo(({ availableBubbleWidth }: ReactionsProps): ReactElement | null => {
  const { item, summary, currentUser, allowInlineEmojiHydration, paintRow } =
    useConversationComposer();
  const messageId = summary?.messageId;
  const paintReactions = paintRow?.reactionPreview?.reactions;
  const reactionsMd = summary?.reactions_md ?? getConversationReactionsMd(item);
  const users = useUsers();
  const zero = useZero();
  const { user } = useAuth();
  const currentUserId = currentUser?.id ?? user?.user_id;
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const handleRemoveReaction = useCallback(
    (emojiName: string) => {
      if (!messageId || !currentUserId) return;
      void zero.mutate(
        mutators.messages.react({
          messageId,
          emojiName,
          action: 'remove',
          timestamp: Date.now(),
        }),
      );
    },
    [currentUserId, messageId, zero],
  );

  const raw = useMemo<RawReaction[]>(() => {
    if (!messageId) return [];
    if (paintRow) return paintReactions ? [...paintReactions] : [];
    return reactionsMdToRawReactions(reactionsMd, messageId);
  }, [messageId, paintReactions, paintRow, reactionsMd]);

  const groups = useMemo(() => groupReactionsForPill(raw), [raw]);
  const total = totalReactionCount(raw);
  const visibleEmojiCount = getVisibleEmojiCount(availableBubbleWidth, total);

  const rows = useMemo<ReactionRow[]>(() => {
    return [...raw]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(r => {
        const isSelf = !!currentUserId && r.userId === currentUserId;
        const orgUser = users.find(u => u.id === r.userId);
        const name = isSelf ? 'You' : (orgUser?.name ?? 'Unknown');
        const picture = orgUser?.picture ?? '';
        return {
          reactionId: r.reactionId,
          userId: r.userId,
          name,
          picture,
          emojiName: r.emojiName,
          createdAt: r.createdAt,
        };
      });
  }, [raw, users, currentUserId]);

  const handleOpen = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    setIsSheetOpen(true);
  }, []);
  const stopPressPropagation = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);

  if (groups.length === 0) return null;

  return (
    <DebugBoundary>
      <View className='h-6 items-end justify-start pr-2'>
        <Pressable
          onPress={handleOpen}
          onPressIn={stopPressPropagation}
          className='flex-row items-center gap-1.5 rounded-full px-1.5 py-0.5 light:bg-[#fafafa] dark:bg-[#1d1f1f]'
          hitSlop={6}
          accessibilityRole='button'
          accessibilityLabel={`${total} ${total === 1 ? 'reaction' : 'reactions'}`}
        >
          {groups.slice(0, visibleEmojiCount).map(g => (
            <ReactionEmojiDisplay
              key={g.emojiName}
              emojiName={g.emojiName}
              size={PILL_EMOJI_SIZE}
              hydrateCustomEmoji={allowInlineEmojiHydration}
            />
          ))}
          {total > 1 ? (
            <Text className='text-xs light:text-[#646464] dark:text-[rgba(255,255,255,0.6)]'>
              {total}
            </Text>
          ) : null}
        </Pressable>
      </View>
      {isSheetOpen ? (
        <ReactionsBottomSheet
          isOpen={isSheetOpen}
          onOpenChange={setIsSheetOpen}
          rows={rows}
          groups={groups}
          total={total}
          currentUserId={currentUserId}
          onRemoveReaction={handleRemoveReaction}
        />
      ) : null}
    </DebugBoundary>
  );
});
Reactions.displayName = 'ConversationComposer.Reactions';

export { Reactions };
