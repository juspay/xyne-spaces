import { AtSign, CaseSensitive, Link2 } from 'lucide-react-native';
import { useCallback, type ReactElement } from 'react';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import {
  useChatInputActions,
  useChatInputHandlers,
  useChatInputRichState,
} from '@/src/components/input-composer';

import {
  TYPING_BAR_ICON_SIZE,
  TYPING_BAR_TOOL_GAP,
  TYPING_BAR_TOOL_HIT_SLOP,
  TYPING_BAR_TOOL_SIZE,
} from '../constants';
import { colorOf } from '../model/token-color';
import { IconButton } from './icon-button';
import { RoomEmojiTool } from './room-emoji-tool';

const ROW_STYLE = { gap: TYPING_BAR_TOOL_GAP } as const;

/** The focused card's tools: Aa (the formatting strip), emoji, a mention and a link. */
export function RoomTools({ disabled }: { disabled: boolean }): ReactElement {
  const { setIsFormattingVisibleState, openLinkModal } = useChatInputActions();
  const { inputRef } = useChatInputHandlers();
  const { selection } = useChatInputRichState();
  const color = colorOf(useCSSVariable('--color-spaces-muted'));

  const showFormatting = useCallback(
    (): void => setIsFormattingVisibleState(true),
    [setIsFormattingVisibleState],
  );
  const mention = useCallback((): void => inputRef.current?.startMention('@'), [inputRef]);
  const link = useCallback((): void => openLinkModal(selection), [openLinkModal, selection]);

  return (
    <View className='flex-row items-center' style={ROW_STYLE}>
      <IconButton
        label='Formatting'
        size={TYPING_BAR_TOOL_SIZE}
        hitSlop={TYPING_BAR_TOOL_HIT_SLOP}
        disabled={disabled}
        onPress={showFormatting}
      >
        <CaseSensitive size={TYPING_BAR_ICON_SIZE} color={color} />
      </IconButton>
      <RoomEmojiTool color={color} disabled={disabled} />
      <IconButton
        label='Mention someone'
        size={TYPING_BAR_TOOL_SIZE}
        hitSlop={TYPING_BAR_TOOL_HIT_SLOP}
        disabled={disabled}
        onPress={mention}
      >
        <AtSign size={TYPING_BAR_ICON_SIZE} color={color} />
      </IconButton>
      <IconButton
        label='Add link'
        size={TYPING_BAR_TOOL_SIZE}
        hitSlop={TYPING_BAR_TOOL_HIT_SLOP}
        disabled={disabled}
        onPress={link}
      >
        <Link2 size={TYPING_BAR_ICON_SIZE} color={color} />
      </IconButton>
    </View>
  );
}
