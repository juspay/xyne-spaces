import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

const EmojiPickerListEmpty = memo(function EmojiPickerListEmpty(): ReactElement {
  return (
    <View className='flex-1 items-center justify-center py-10'>
      <Text className='text-sm text-muted'>No emojis found</Text>
    </View>
  );
});

EmojiPickerListEmpty.displayName = 'EmojiPickerListEmpty';

export { EmojiPickerListEmpty };
