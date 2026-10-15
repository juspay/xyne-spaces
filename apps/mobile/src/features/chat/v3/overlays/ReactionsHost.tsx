import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { groupReactionsForPill } from '@/src/components/chat/message/reactions/reaction-pill.utils';
import Avatar from '@/src/components/ui/avatar';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useUsers } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { reactionsMdToRawReactions } from '@/src/utils/conversationMessageHelpers';
import { cn } from '@/src/utils/cn';
import { mutators } from '@/src/zero/mutators';
import { reactionRowsFor } from './reactionRows';

export type ReactionsTarget = {
  messageId: string;
  reactionsMd: string | null;
};

export type ReactionsHostProps = {
  target: ReactionsTarget | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string | undefined;
};

export function ReactionsHost({
  target,
  isOpen,
  onOpenChange,
  currentUserId,
}: ReactionsHostProps): ReactElement | null {
  const users = useUsers();
  const zero = useZero();
  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;
  const { accentSoft, accentText } = useBubbleAccent();
  const [filterEmoji, setFilterEmoji] = useState<string | null>(null);

  const raw = useMemo(
    () => (target ? reactionsMdToRawReactions(target.reactionsMd, target.messageId) : []),
    [target],
  );
  const groups = useMemo(() => groupReactionsForPill(raw), [raw]);
  const rows = useMemo(
    () =>
      reactionRowsFor(
        raw,
        (userId: string) => {
          const user = users.find(item => item.id === userId);
          return user ? { name: user.name, picture: user.picture ?? '' } : undefined;
        },
        currentUserId,
      ),
    [raw, users, currentUserId],
  );
  const visibleRows = filterEmoji ? rows.filter(row => row.emojiName === filterEmoji) : rows;

  if (!target || rows.length === 0) {
    return null;
  }

  const total = rows.length;
  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={(open: boolean): void => {
        if (!open) {
          setFilterEmoji(null);
        }
        onOpenChange(open);
      }}
      mode='snap'
      snapPoints={['50%', '80%']}
      backdropOpacity={0.5}
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
        <View style={{ height: 56 }}>
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
          >
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={`All ${total}`}
              onPress={(): void => setFilterEmoji(null)}
              className={cn(
                'flex-row items-center gap-1 rounded-full border-[0.5px] px-3 py-1.5',
                filterEmoji === null ? '' : 'border-foreground/15 bg-card',
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
                  filterEmoji === null ? 'font-bold' : 'font-semibold text-tab-inactive-text',
                )}
                style={filterEmoji === null ? { color: accentText } : undefined}
              >
                All {total}
              </Text>
            </Pressable>
            {groups.map(group => {
              const active = filterEmoji === group.emojiName;
              return (
                <Pressable
                  key={group.emojiName}
                  accessibilityRole='button'
                  onPress={(): void =>
                    setFilterEmoji(prev => (prev === group.emojiName ? null : group.emojiName))
                  }
                  className={cn(
                    'flex-row items-center gap-1 rounded-full border-[0.5px] px-3 py-1.5',
                    active ? '' : 'border-foreground/15 bg-card',
                  )}
                  style={
                    active ? { backgroundColor: accentSoft, borderColor: accentText } : undefined
                  }
                >
                  <ReactionEmojiDisplay emojiName={group.emojiName} />
                  <Text
                    className={cn(
                      'text-sm',
                      active ? 'font-bold' : 'font-semibold text-tab-inactive-text',
                    )}
                    style={active ? { color: accentText } : undefined}
                  >
                    {group.count}
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
          {visibleRows.map(row => (
            <Pressable
              key={row.reactionId}
              accessibilityRole={row.isSelf ? 'button' : undefined}
              accessibilityLabel={`${row.name} ${row.emojiName}`}
              accessibilityHint={row.isSelf ? 'Tap to remove your reaction' : undefined}
              disabled={!row.isSelf}
              className={cn(
                'flex-row items-center gap-3 rounded-lg px-2 py-2.5',
                row.isSelf && 'active:bg-accent',
              )}
              onPress={
                row.isSelf
                  ? (): void => {
                      void zero.mutate(
                        mutators.messages.react({
                          messageId: target.messageId,
                          emojiName: row.emojiName,
                          action: 'remove',
                          timestamp: Date.now(),
                        }),
                      );
                      onOpenChange(false);
                    }
                  : undefined
              }
            >
              <Avatar userIds={[row.userId]} size={32} />
              <Text className='flex-1 text-base text-foreground' numberOfLines={1}>
                {row.name}
              </Text>
              <ReactionEmojiDisplay emojiName={row.emojiName} />
            </Pressable>
          ))}
        </BottomSheetScrollView>
      </View>
    </AppBottomSheet>
  );
}
