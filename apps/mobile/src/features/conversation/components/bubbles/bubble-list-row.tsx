import { memo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  BUBBLE_LIST_ICON_SIZE,
  BUBBLE_LIST_REMOVE_SIZE,
  BUBBLE_LIST_ROW_GAP,
  BUBBLE_LIST_ROW_HEIGHT,
  BUBBLE_LIST_ROW_PADDING_LEFT,
  BUBBLE_LIST_ROW_PADDING_RIGHT,
  BUBBLE_LIST_TILE_SIZE,
  BUBBLE_SHADOW,
} from '../../constants';
import type { ParkedThread } from '../../model/bubbles';
import { colorOf } from '../../model/token-color';
import { IconButton } from '../icon-button';
import { BubbleFaces } from './bubble-faces';

type BubbleListRowProps = {
  thread: ParkedThread;
  width: number;
  onOpen: (thread: ParkedThread) => void;
  onRemove: (threadId: string) => void;
};

/**
 * Figma "Bubble / List row": a parked thread as a pill, its faces left, the
 * message it hangs off and its channel right, and × to let it go.
 */
export const BubbleListRow = memo(function BubbleListRow({
  thread,
  width,
  onOpen,
  onRemove,
}: BubbleListRowProps): ReactElement {
  const foreground = colorOf(useCSSVariable('--color-spaces-foreground'));

  return (
    <View
      className='flex-row items-center bg-spaces-surface-raised'
      style={{
        width,
        height: BUBBLE_LIST_ROW_HEIGHT,
        borderRadius: BUBBLE_LIST_ROW_HEIGHT / 2,
        paddingLeft: BUBBLE_LIST_ROW_PADDING_LEFT,
        paddingRight: BUBBLE_LIST_ROW_PADDING_RIGHT,
        columnGap: BUBBLE_LIST_ROW_GAP,
        boxShadow: BUBBLE_SHADOW,
      }}
    >
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`Open thread ${thread.title}, ${thread.channelName}`}
        onPress={() => onOpen(thread)}
        className='min-w-0 flex-1 flex-row items-center active:opacity-60'
        style={{ columnGap: BUBBLE_LIST_ROW_GAP, alignSelf: 'stretch' }}
      >
        <View style={{ width: BUBBLE_LIST_TILE_SIZE, height: BUBBLE_LIST_TILE_SIZE }}>
          <BubbleFaces faceIds={thread.faceIds} tile='row' />
        </View>
        <View className='min-w-0 flex-1' style={{ rowGap: 1 }}>
          <Text
            className='text-[16px] font-medium leading-5 tracking-[-0.24px] text-spaces-foreground'
            numberOfLines={1}
          >
            {thread.title}
          </Text>
          <Text className='text-[12px] leading-4 text-spaces-muted' numberOfLines={1}>
            {thread.channelName}
          </Text>
        </View>
      </Pressable>
      <IconButton
        label={`Let go of thread ${thread.title}`}
        size={BUBBLE_LIST_REMOVE_SIZE}
        onPress={() => onRemove(thread.threadId)}
      >
        <X size={BUBBLE_LIST_ICON_SIZE} color={foreground} />
      </IconButton>
    </View>
  );
});
