import { memo, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, Hash, Lock } from 'lucide-react-native';
import { ChannelScopeType, ChannelType, ChannelVisibility } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';
import { useAllVisibleChannels } from '@/src/hooks/useChannels';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';
import { CHANNEL_ICON_GLYPH_SIZE } from './channel-list-layout';

/** Slightly tighter than a list row's glyph — these sit in a denser list. */
const GLYPH_SIZE = CHANNEL_ICON_GLYPH_SIZE - 3;

/** The shape the section sheets need from a channel — nothing more. */
export type PickerChannel = {
  id: string;
  name: string;
  visibility: ChannelVisibility;
};

/**
 * Channels a section can hold: real workspace channels the user can see,
 * including starred ones so they remain selectable from the picker.
 */
export function useSectionableChannels(): PickerChannel[] {
  const visibleChannels = useAllVisibleChannels();

  return useMemo(() => {
    return visibleChannels
      .filter(channel => {
        if (channel.type === ChannelType.EMAIL) return false;
        if (channel.scopeType !== ChannelScopeType.DEFAULT) return false;
        return true;
      })
      .map(channel => ({
        id: channel.id,
        name: channel.name,
        visibility: channel.visibility,
      }));
  }, [visibleChannels]);
}

/**
 * Name filter only. The order stays exactly as the workspace lists it: floating
 * the selection to the top used to yank a row out from under the finger that
 * had just ticked it. The picker's chip strip carries selection visibility
 * instead.
 */
export function useFilteredPickerChannels(
  channels: readonly PickerChannel[],
  filter: string,
): PickerChannel[] {
  return useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return [...channels];
    return channels.filter(channel => channel.name?.toLowerCase().includes(query));
  }, [channels, filter]);
}

type SectionChannelRowProps = {
  channel: PickerChannel;
  isSelected: boolean;
  onToggle: (channelId: string) => void;
};

export const SectionChannelRow = memo(function SectionChannelRow({
  channel,
  isSelected,
  onToggle,
}: SectionChannelRowProps): ReactElement {
  const { accentBg, accentFg } = useBubbleAccent();
  const mutedColor = useCSSVariable('--color-bottomsheet-text-muted') as string;
  const isPrivate = channel.visibility === ChannelVisibility.PRIVATE;

  return (
    <Pressable
      onPress={() => onToggle(channel.id)}
      accessibilityRole='checkbox'
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={channel.name}
      className='flex-row items-center rounded-xl px-3 py-2.5 active:opacity-60'
    >
      <View
        className={cn(
          'mr-3 size-5 items-center justify-center rounded-md border-2',
          !isSelected && 'border-border',
        )}
        style={isSelected ? { backgroundColor: accentBg, borderColor: accentBg } : undefined}
      >
        {isSelected ? <Check size={12} color={accentFg} strokeWidth={3} /> : null}
      </View>

      <View className='w-5 items-center mr-1.5'>
        {isPrivate ? (
          <Lock size={GLYPH_SIZE} color={mutedColor} strokeWidth={2} />
        ) : (
          <Hash size={GLYPH_SIZE} color={mutedColor} strokeWidth={2} />
        )}
      </View>

      <Text className='flex-1 text-[15px] text-foreground' numberOfLines={1}>
        {channel.name}
      </Text>
    </Pressable>
  );
});
