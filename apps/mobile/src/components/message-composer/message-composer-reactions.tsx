import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
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
import { useUsers } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { cn } from '@/src/utils/cn';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import { useMessageComposer } from './message-composer-context';
import { DebugBoundary } from './utils/debug-boundary';

const PILL_EMOJI_SIZE = 14;
const MAX_VISIBLE_EMOJIS = 4;
const CHIPS_ROW_HEIGHT = 56;

type ReactionRow = {
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

const ReactionsBottomSheet = ({
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
                onPress={isSelf ? () => onRemoveReaction(item.emojiName) : undefined}
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

const Reactions = memo((): ReactElement | null => {
  const { item, currentUser } = useMessageComposer();
  const messageId = item.messageId;
  const reactionsMd = item.reactions_md ?? null;
  const users = useUsers();
  const zero = useZero();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const handleRemoveReaction = useCallback(
    (emojiName: string) => {
      if (!messageId) return;
      void zero.mutate(
        mutators.messages.react({
          messageId,
          emojiName,
          action: 'remove',
          timestamp: Date.now(),
        }),
      );
    },
    [messageId, zero],
  );

  const raw = useMemo<RawReaction[]>(() => {
    if (!messageId) return [];
    return reactionsMdToRawReactions(reactionsMd, messageId);
  }, [messageId, reactionsMd]);

  const groups = useMemo(() => groupReactionsForPill(raw), [raw]);
  const total = totalReactionCount(raw);

  const rows = useMemo<ReactionRow[]>(() => {
    return [...raw]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(r => {
        const isSelf = !!currentUser?.id && r.userId === currentUser.id;
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
  }, [raw, users, currentUser?.id]);

  const handleOpen = useCallback(() => setIsSheetOpen(true), []);

  if (groups.length === 0) return null;

  return (
    <DebugBoundary>
      <Pressable
        onPress={handleOpen}
        className='absolute bottom-[-18px] right-1 flex-row items-center gap-1.5 rounded-full px-1.5 py-0.5 light:bg-[#fafafa] dark:bg-[#1d1f1f]'
        hitSlop={6}
        accessibilityRole='button'
        accessibilityLabel={`${total} ${total === 1 ? 'reaction' : 'reactions'}`}
      >
        {groups.slice(0, MAX_VISIBLE_EMOJIS).map(g => (
          <ReactionEmojiDisplay key={g.emojiName} emojiName={g.emojiName} size={PILL_EMOJI_SIZE} />
        ))}
        {total > 1 ? (
          <Text className='text-xs light:text-[#646464] dark:text-[rgba(255,255,255,0.6)]'>
            {total}
          </Text>
        ) : null}
      </Pressable>
      <ReactionsBottomSheet
        isOpen={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        rows={rows}
        groups={groups}
        total={total}
        currentUserId={currentUser?.id}
        onRemoveReaction={handleRemoveReaction}
      />
    </DebugBoundary>
  );
});
Reactions.displayName = 'MessageComposer.Reactions';

export { Reactions };
