import { memo, type ReactElement } from 'react';
import { View } from 'react-native';
import { Search } from 'lucide-react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';

type EmojiPickerSearchProps = {
  value: string;
  onChangeText: (text: string) => void;
  foreground: string;
};

const EmojiPickerSearch = memo(function EmojiPickerSearch({
  value,
  onChangeText,
  foreground,
}: EmojiPickerSearchProps): ReactElement {
  return (
    <View className='px-3 pt-3'>
      <View className='flex-row items-center rounded-xl border border-border bg-card px-3'>
        <Search size={16} color={foreground} />
        <BottomSheetTextInput
          className='ml-2 flex-1 py-2 text-sm text-foreground leading-tight'
          placeholder='Search emoji...'
          placeholderTextColor={foreground + '80'}
          value={value}
          onChangeText={onChangeText}
          autoCorrect={false}
          autoCapitalize='none'
          spellCheck={false}
        />
      </View>
    </View>
  );
});

EmojiPickerSearch.displayName = 'EmojiPickerSearch';

export { EmojiPickerSearch };
