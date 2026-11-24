import { Plus } from 'lucide-react-native';
import { memo, useCallback, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';

import {
  ADD_REACTION_CHIP_WIDTH,
  ADD_REACTION_ICON_SIZE,
  REACTION_CHIP_HEIGHT,
  REACTION_CHIP_INNER_GAP,
  REACTION_CHIP_PADDING_X,
  REACTION_CHIP_RADIUS,
  REACTION_EMOJI_LINE_HEIGHT,
  REACTION_EMOJI_SIZE,
} from '../constants';

const CHIP_STYLE = {
  height: REACTION_CHIP_HEIGHT,
  borderRadius: REACTION_CHIP_RADIUS,
  paddingHorizontal: REACTION_CHIP_PADDING_X,
  columnGap: REACTION_CHIP_INNER_GAP,
} as const;
const ADD_CHIP_STYLE = {
  width: ADD_REACTION_CHIP_WIDTH,
  height: REACTION_CHIP_HEIGHT,
  borderRadius: REACTION_CHIP_RADIUS,
} as const;
const EMOJI_BOX_STYLE = { height: REACTION_EMOJI_LINE_HEIGHT } as const;

type ReactionChipProps = {
  /** Handed back to `onPress`, so a list of chips can share one handler. */
  id: string;
  /** The count, or a word such as "All 5" for a chip without an emoji. */
  label: string;
  emojiName?: string | undefined;
  hydrateCustomEmoji?: boolean | undefined;
  /** Sits on the container surface; an unselected sheet tab is bare. */
  filled?: boolean | undefined;
  accessibilityLabel: string;
  onPress: (id: string) => void;
  onLongPress?: ((id: string) => void) | undefined;
};

/** One reaction pill: the emoji and its count. Under messages and as the who-reacted sheet's tabs. */
export const ReactionChip = memo(function ReactionChip({
  id,
  label,
  emojiName,
  hydrateCustomEmoji = true,
  filled = true,
  accessibilityLabel,
  onPress,
  onLongPress,
}: ReactionChipProps): ReactElement {
  const handlePress = useCallback((): void => onPress(id), [id, onPress]);
  const handleLongPress = useCallback((): void => onLongPress?.(id), [id, onLongPress]);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel}
      onPress={handlePress}
      {...(onLongPress ? { onLongPress: handleLongPress } : {})}
      className={`flex-row items-center ${filled ? 'bg-spaces-surface' : ''}`}
      style={CHIP_STYLE}
    >
      {emojiName ? (
        <View className='justify-center' style={EMOJI_BOX_STYLE}>
          <ReactionEmojiDisplay
            emojiName={emojiName}
            size={REACTION_EMOJI_SIZE}
            hydrateCustomEmoji={hydrateCustomEmoji}
          />
        </View>
      ) : null}
      <Text className='text-[12px] font-medium leading-4 text-spaces-muted'>{label}</Text>
    </Pressable>
  );
});

type AddReactionChipProps = {
  iconColor: string;
  onPress: () => void;
};

/** The pill ending a row of reactions: a plus that opens the emoji picker. */
export const AddReactionChip = memo(function AddReactionChip({
  iconColor,
  onPress,
}: AddReactionChipProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Add reaction'
      onPress={onPress}
      className='items-center justify-center bg-spaces-surface'
      style={ADD_CHIP_STYLE}
    >
      <Plus size={ADD_REACTION_ICON_SIZE} color={iconColor} />
    </Pressable>
  );
});
