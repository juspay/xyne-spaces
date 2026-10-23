import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { emojiPickerStyles } from '../emoji-picker.styles';

type EmojiPickerSectionHeaderProps = {
  label: string;
};

const EmojiPickerSectionHeader = memo(function EmojiPickerSectionHeader({
  label,
}: EmojiPickerSectionHeaderProps): ReactElement {
  return (
    <View style={emojiPickerStyles.sectionHeader}>
      <Text className='text-[12px] font-semibold text-secondary-foreground'>{label}</Text>
    </View>
  );
});

EmojiPickerSectionHeader.displayName = 'EmojiPickerSectionHeader';

export { EmojiPickerSectionHeader };
