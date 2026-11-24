import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useCSSVariable } from 'uniwind';

import type { RawReaction } from '@/src/components/chat/message/reactions/reaction-pill.utils';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import {
  useReactionsSheetModel,
  type ReactionRow,
} from '@/src/features/chat/v2/components/conversation-composer/conversation-composer-reactions';
import { AvatarFace } from '@/src/ui/avatar';

import {
  REACTION_CHIP_GAP,
  REACTIONS_SHEET_AVATAR_SIZE,
  REACTIONS_SHEET_EMOJI_SIZE,
  REACTIONS_SHEET_PADDING,
  REACTIONS_SHEET_RADIUS,
  REACTIONS_SHEET_ROW_GAP,
  REACTIONS_SHEET_ROW_PADDING_Y,
} from '../constants';
import { ReactionChip } from './reaction-chip';

const SNAP_POINTS = ['50%', '80%'];
const ALL_TAB = 'all';
const TABS_CONTENT_STYLE = {
  flexDirection: 'row',
  columnGap: REACTION_CHIP_GAP,
  paddingHorizontal: REACTIONS_SHEET_PADDING,
  paddingBottom: REACTIONS_SHEET_PADDING,
} as const;
const TABS_STYLE = { flexGrow: 0 } as const;
const ROWS_CONTENT_STYLE = {
  paddingHorizontal: REACTIONS_SHEET_PADDING,
  paddingBottom: REACTIONS_SHEET_PADDING,
} as const;
const ROW_STYLE = {
  paddingVertical: REACTIONS_SHEET_ROW_PADDING_Y,
  columnGap: REACTIONS_SHEET_ROW_GAP,
} as const;

type ReactionsSheetProps = {
  reactions: readonly RawReaction[];
  currentUserId: string | undefined;
  hydrateCustomEmoji: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
};

/**
 * Who reacted (Figma screen 15): the reaction pills as tabs, then one row per
 * person. Your own row removes your reaction, as in the classic sheet.
 */
export function ReactionsSheet({
  reactions,
  currentUserId,
  hydrateCustomEmoji,
  isOpen,
  onOpenChange,
  onDismiss,
}: ReactionsSheetProps): ReactElement {
  const background = useCSSVariable('--color-spaces-background');
  const { groups, total, rows, handleRemoveReaction } = useReactionsSheetModel({
    raw: reactions,
    messageId: reactions[0]?.messageId,
    currentUserId,
  });
  const [tab, setTab] = useState(ALL_TAB);

  const visibleRows = useMemo(
    () => (tab === ALL_TAB ? rows : rows.filter(row => row.emojiName === tab)),
    [rows, tab],
  );
  const backgroundStyle = useMemo(
    () => ({
      backgroundColor: typeof background === 'string' ? background : undefined,
      borderTopLeftRadius: REACTIONS_SHEET_RADIUS,
      borderTopRightRadius: REACTIONS_SHEET_RADIUS,
    }),
    [background],
  );

  const handleRemove = useCallback(
    (emojiName: string): void => {
      handleRemoveReaction(emojiName);
      onOpenChange(false);
    },
    [handleRemoveReaction, onOpenChange],
  );

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      mode='snap'
      snapPoints={SNAP_POINTS}
      backgroundStyle={backgroundStyle}
    >
      <BottomSheetScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={TABS_STYLE}
        contentContainerStyle={TABS_CONTENT_STYLE}
      >
        <ReactionChip
          id={ALL_TAB}
          label={`All ${total}`}
          filled={tab === ALL_TAB}
          accessibilityLabel={`All reactions, ${total}`}
          onPress={setTab}
        />
        {groups.map(group => (
          <ReactionChip
            key={group.emojiName}
            id={group.emojiName}
            label={String(group.count)}
            emojiName={group.emojiName}
            hydrateCustomEmoji={hydrateCustomEmoji}
            filled={tab === group.emojiName}
            accessibilityLabel={`${group.emojiName}, ${group.count}`}
            onPress={setTab}
          />
        ))}
      </BottomSheetScrollView>
      <BottomSheetScrollView contentContainerStyle={ROWS_CONTENT_STYLE}>
        {visibleRows.map(row => (
          <ReactorRow
            key={row.reactionId}
            row={row}
            isSelf={!!currentUserId && row.userId === currentUserId}
            hydrateCustomEmoji={hydrateCustomEmoji}
            onRemove={handleRemove}
          />
        ))}
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}

type ReactorRowProps = {
  row: ReactionRow;
  isSelf: boolean;
  hydrateCustomEmoji: boolean;
  onRemove: (emojiName: string) => void;
};

function ReactorRow({ row, isSelf, hydrateCustomEmoji, onRemove }: ReactorRowProps): ReactElement {
  const handlePress = useCallback((): void => onRemove(row.emojiName), [onRemove, row.emojiName]);

  return (
    <Pressable
      disabled={!isSelf}
      onPress={isSelf ? handlePress : undefined}
      accessibilityRole={isSelf ? 'button' : undefined}
      accessibilityHint={isSelf ? 'Tap to remove your reaction' : undefined}
      className='flex-row items-center'
      style={ROW_STYLE}
    >
      <AvatarFace userId={row.userId} size={REACTIONS_SHEET_AVATAR_SIZE} />
      <Text
        className='min-w-0 flex-1 text-[16px] font-medium leading-[22px] text-spaces-foreground'
        numberOfLines={1}
      >
        {row.name}
      </Text>
      <ReactionEmojiDisplay
        emojiName={row.emojiName}
        size={REACTIONS_SHEET_EMOJI_SIZE}
        hydrateCustomEmoji={hydrateCustomEmoji}
      />
    </Pressable>
  );
}
