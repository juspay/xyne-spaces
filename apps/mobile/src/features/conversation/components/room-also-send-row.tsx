import { Check } from 'lucide-react-native';
import { memo, useCallback, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useChatInputConversation } from '@/src/components/input-composer';
import { useAlsoSendToChannel } from '@/src/components/input-composer/input-composer-also-send-to-channel';
import { useVisibleChannelById } from '@/src/hooks/useChannels';
import { haptics } from '@/src/utils/haptics';
import { cn } from '@/src/utils/cn';

import {
  TYPING_BAR_CHECK_BORDER,
  TYPING_BAR_CHECK_ICON_SIZE,
  TYPING_BAR_CHECK_SIZE,
  TYPING_BAR_STRIP_GAP,
  TYPING_BAR_STRIP_HEIGHT,
  TYPING_BAR_STRIP_HIT_SLOP,
} from '../constants';
import { alsoSendLabel } from '../model/also-send';
import { roomKindOf } from '../model/room-title';
import { colorOf } from '../model/token-color';

const ROW_STYLE = { minHeight: TYPING_BAR_STRIP_HEIGHT, gap: TYPING_BAR_STRIP_GAP } as const;
const CHECK_STYLE = {
  width: TYPING_BAR_CHECK_SIZE,
  height: TYPING_BAR_CHECK_SIZE,
  borderRadius: TYPING_BAR_CHECK_SIZE / 2,
  borderWidth: TYPING_BAR_CHECK_BORDER,
} as const;
const HIT_SLOP = { top: TYPING_BAR_STRIP_HIT_SLOP, bottom: TYPING_BAR_STRIP_HIT_SLOP } as const;

/**
 * A thread reply's "Also send to #channel" choice, over the bar when the
 * classic one shows (a reply with something to send, outside an edit). The
 * channel's name comes from the visible channels the app already holds.
 */
function RoomAlsoSendRowComponent(): ReactElement | null {
  const { conversationId } = useChatInputConversation();
  const { visible, checked, toggle } = useAlsoSendToChannel();
  const channel = useVisibleChannelById(conversationId);
  const accentForeground = colorOf(useCSSVariable('--color-spaces-accent-foreground'));
  const label = alsoSendLabel(channel?.name ?? '', roomKindOf(channel?.scopeType));

  const handlePress = useCallback((): void => {
    void haptics.selection();
    toggle();
  }, [toggle]);

  if (!visible) return null;

  return (
    <Pressable
      accessibilityRole='checkbox'
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      hitSlop={HIT_SLOP}
      onPress={handlePress}
      // No bottom padding: the 32 row already leaves 7 under the check, about the 8 every stacked strip keeps.
      className='flex-row items-center self-start px-4 active:opacity-60'
    >
      <View className='shrink flex-row items-center' style={ROW_STYLE}>
        <View
          className={cn(
            'items-center justify-center',
            checked ? 'border-spaces-accent bg-spaces-accent' : 'border-spaces-subtle',
          )}
          style={CHECK_STYLE}
        >
          {checked ? <Check size={TYPING_BAR_CHECK_ICON_SIZE} color={accentForeground} /> : null}
        </View>
        <Text className='shrink text-[14px] leading-[18px] text-spaces-muted' numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export const RoomAlsoSendRow = memo(RoomAlsoSendRowComponent);
RoomAlsoSendRow.displayName = 'RoomAlsoSendRow';
