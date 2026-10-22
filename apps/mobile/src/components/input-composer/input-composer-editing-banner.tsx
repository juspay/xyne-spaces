import { Pencil, X } from 'lucide-react-native';
import { memo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useChatInputConversation, useChatInputHandlers } from './input-composer-context';

const EditingBannerComponent = (): ReactElement | null => {
  const { isEditing } = useChatInputConversation();
  const { onCancelEdit } = useChatInputHandlers();
  const secondaryForeground = useCSSVariable('--color-secondary-foreground') as string;
  const borderColor = useCSSVariable('--color-border') as string;

  if (!isEditing) return null;

  return (
    <View
      className='self-start flex-row items-center gap-2 rounded-full border bg-accent/60 px-3 py-1.5'
      style={{ borderColor }}
    >
      <View className='min-w-0 flex-row items-center gap-2'>
        <Pencil size={14} color={secondaryForeground} />
        <Text
          className='text-xs font-medium'
          style={{ color: secondaryForeground }}
          numberOfLines={1}
        >
          Editing message
        </Text>
      </View>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Stop editing'
        hitSlop={10}
        className='shrink-0 rounded-full p-0.5 active:bg-accent'
        onPress={() => {
          onCancelEdit?.();
        }}
      >
        <X size={18} color={secondaryForeground} />
      </Pressable>
    </View>
  );
};

const EditingBanner = memo(EditingBannerComponent);
EditingBanner.displayName = 'ChatInput.EditingBanner';

export { EditingBanner };
