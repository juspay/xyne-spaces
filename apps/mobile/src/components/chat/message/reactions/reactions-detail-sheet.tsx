import { LegendList } from '@legendapp/list/react-native';

import { BottomSheet } from '@/src/components/ui/bottom-sheet';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useCallback, useMemo, useState } from 'react';
import { SmilePlus } from 'lucide-react-native';
import Avatar from '@/src/components/ui/avatar';
import { useReactions } from '@/src/hooks/useReactions';
import { useReactionsDetail } from './reactions-detail.context';
import { groupReactionsForPill, totalReactionCount, type RawReaction } from './reaction-pill.utils';
import type { MessageSheetTarget } from '@/src/components/chat/message-sheet/message-sheet.types';
import { ReactionEmojiDisplay } from './reaction-emoji-display';
import { EmojiPickerBottomSheet, type EmojiPickerSelection } from '@/src/components/emoji-picker';

type ParticipantRow = {
  userId: string;
  name: string;
  picture: string;
};

type ReactionDetailRow = ParticipantRow & {
  emojiName: string;
  reactionId: string;
};

type ParticipantWithOptionalUser = {
  userId: string;
  user?: { name?: string | null; picture?: string | null } | null;
};

const ESTIMATED_REACTION_ROW_SIZE = 56;

/**
 * Order: channel lookup (from provider) → conversation participants → legacy nested `sender` (V1 only).
 * V2 rows have no `sender`; screens should pass `resolveReactionUser` that also resolves org users (e.g. useUsers).
 */
function resolveReactionDisplay(
  message: MessageSheetTarget,
  userId: string,
  lookupFromChannel?: (userId: string) => { name: string; picture: string } | undefined,
): ParticipantRow {
  let resolved: ParticipantRow;

  const fromChannel = lookupFromChannel?.(userId);
  if (fromChannel?.name) {
    resolved = {
      userId,
      name: fromChannel.name,
      picture: fromChannel.picture ?? '',
    };
  } else {
    // V2 channel rows omit `participants`; thread / V1 rows may include them (MessageDataLike).
    const participants =
      'participants' in message && message.participants ? message.participants : undefined;
    const participant = participants?.find(
      (p: ParticipantWithOptionalUser) => p.userId === userId,
    ) as ParticipantWithOptionalUser | undefined;

    const u =
      participant && 'user' in participant
        ? (participant as ParticipantWithOptionalUser).user
        : undefined;

    if (u?.name) {
      resolved = {
        userId,
        name: u.name,
        picture: u.picture ?? '',
      };
    } else {
      const im = message.initialMessage;
      if (
        im?.senderId === userId &&
        'sender' in im &&
        im.sender &&
        typeof im.sender === 'object' &&
        'name' in im.sender
      ) {
        resolved = {
          userId,
          name: im.sender.name ?? 'Unknown',
          picture: (im.sender as { picture?: string | null }).picture ?? '',
        };
      } else {
        resolved = { userId, name: 'Unknown', picture: '' };
      }
    }
  }

  if (userId === message.currentUserId) {
    return { ...resolved, name: 'You' };
  }
  return resolved;
}

export function ReactionsDetailSheet() {
  const { isOpen, close, activeMessage, getTargetRef, resolveReactionUser } = useReactionsDetail();
  const { toggleReaction } = useReactions();
  const [filterEmoji, setFilterEmoji] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const reactions = useMemo(
    () => (activeMessage?.initialMessage?.reactions ?? []) as RawReaction[],
    [activeMessage],
  );

  const groups = useMemo(() => groupReactionsForPill(reactions), [reactions]);
  const total = totalReactionCount(reactions);

  const rows = useMemo((): ReactionDetailRow[] => {
    if (!activeMessage) return [];
    let list = [...reactions].sort((a, b) => a.createdAt - b.createdAt);
    if (filterEmoji) {
      list = list.filter(r => r.emojiName === filterEmoji);
    }
    return list.map(r => ({
      ...resolveReactionDisplay(activeMessage, r.userId, resolveReactionUser),
      emojiName: r.emojiName,
      reactionId: r.reactionId,
    }));
  }, [activeMessage, reactions, filterEmoji, resolveReactionUser]);

  const onQuickReact = useCallback(
    (emoji: string) => {
      const msg = getTargetRef();
      if (!msg?.initialMessage?.messageId) return;
      const uid = msg.currentUserId;
      const hasReacted = !!(msg.initialMessage.reactions ?? []).some(
        r => r.emojiName === emoji && r.userId === uid,
      );
      toggleReaction({
        messageId: msg.initialMessage.messageId,
        emoji,
        hasReacted,
      });
    },
    [getTargetRef, toggleReaction],
  );

  const onEmojiPicked = useCallback(
    (selection: EmojiPickerSelection) => {
      const emojiValue =
        selection.type === 'custom'
          ? `custom:${selection.emojiId}:${selection.name}`
          : selection.value;
      onQuickReact(emojiValue);
      setEmojiPickerOpen(false);
    },
    [onQuickReact],
  );

  const handleSheetOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        close();
        setFilterEmoji(null);
      }
    },
    [close],
  );

  const keyExtractor = useCallback((item: ReactionDetailRow) => item.reactionId, []);

  const renderReactionRow = useCallback(
    ({ item: row }: { item: ReactionDetailRow }) => (
      <View className='flex-row items-center gap-3 border-b border-neutral-200 px-2 py-2.5'>
        <Avatar userIds={[row.userId]} size={32} />
        <Text className='flex-1 text-base text-neutral-900' numberOfLines={1}>
          {row.name}
        </Text>
        <ReactionEmojiDisplay emojiName={row.emojiName} />
      </View>
    ),
    [],
  );

  return (
    <>
      <BottomSheet isOpen={isOpen} onOpenChange={handleSheetOpenChange}>
        <BottomSheet.Portal>
          <BottomSheet.Overlay />
          <BottomSheet.Content
            snapPoints={['50%', '88%']}
            index={0}
            contentContainerClassName='p-0 flex-1'
          >
            {activeMessage && total > 0 ? (
              <View className='min-h-0 flex-1 pb-safe'>
                <Text className='px-4 text-base font-semibold text-neutral-900'>
                  {total} {total === 1 ? 'reaction' : 'reactions'}
                </Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className='mt-3 px-3'
                  contentContainerClassName='gap-2 items-center flex-row'
                  keyboardShouldPersistTaps='handled'
                >
                  <Pressable
                    onPress={() => setEmojiPickerOpen(true)}
                    className='h-9 w-9 items-center justify-center rounded-full bg-neutral-200 active:bg-neutral-300'
                  >
                    <SmilePlus size={20} color='#525252' />
                  </Pressable>

                  <Pressable
                    onPress={() => setFilterEmoji(null)}
                    className={`rounded-full px-3 py-1.5 ${
                      filterEmoji === null ? 'bg-[#dce8c8]' : 'bg-neutral-200'
                    }`}
                  >
                    <Text className='text-sm text-neutral-800'>All {total}</Text>
                  </Pressable>

                  {groups.map(g => (
                    <Pressable
                      key={g.emojiName}
                      onPress={() =>
                        setFilterEmoji(prev => (prev === g.emojiName ? null : g.emojiName))
                      }
                      className={`flex-row items-center gap-1 rounded-full px-3 py-1.5 ${
                        filterEmoji === g.emojiName ? 'bg-[#dce8c8]' : 'bg-neutral-200'
                      }`}
                    >
                      <ReactionEmojiDisplay emojiName={g.emojiName} />
                      <Text className='text-xs text-neutral-600'>{g.count}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <LegendList
                  style={{ flex: 1, minHeight: 0 }}
                  className='mt-4 px-2'
                  data={rows}
                  keyExtractor={keyExtractor}
                  renderItem={renderReactionRow}
                  estimatedItemSize={ESTIMATED_REACTION_ROW_SIZE}
                  recycleItems
                  nestedScrollEnabled
                  keyboardShouldPersistTaps='handled'
                  showsVerticalScrollIndicator
                />
              </View>
            ) : null}
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>

      <EmojiPickerBottomSheet
        isOpen={emojiPickerOpen}
        onSelect={onEmojiPicked}
        onOpenChange={open => {
          if (!open) {
            setEmojiPickerOpen(false);
          }
        }}
      />
    </>
  );
}
