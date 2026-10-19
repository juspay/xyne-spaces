import { type ReactElement, useEffect, useRef } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Extra classes applied to the outermost wrapper View */
  containerClassName?: string;
  /** Extra classes applied to the TextInput */
  inputClassName?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
}

/**
 * A reusable search bar component whose UI is based on the Channels screen search bar.
 * Pass `containerClassName` / `inputClassName` to adapt sizing or background per context.
 */
export const SearchBar = ({
  value,
  onChangeText,
  placeholder = 'Search',
  autoFocus = false,
  containerClassName = '',
  inputClassName = '',
  autoCapitalize = 'none',
  autoCorrect = false,
}: SearchBarProps): ReactElement => {
  const inputRef = useRef<TextInput>(null);
  const secondaryTextColor = useCSSVariable('--color-secondary-text') as string;

  useEffect(() => {
    if (!autoFocus) return;

    inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <View
      className={`relative h-10 flex-row items-center ${containerClassName}`}
      onTouchStart={event => {
        event.stopPropagation();
      }}
    >
      <View className='absolute left-4 top-0 z-10 h-10 justify-center'>
        <Search size={18} color={secondaryTextColor} />
      </View>
      <TextInput
        ref={inputRef}
        className={`flex-1 h-10 pl-11 pr-10 rounded-xl bg-foreground/5 text-[18px] text-foreground font-semibold ${inputClassName}`}
        style={{ textAlignVertical: 'center' }}
        placeholder={placeholder}
        placeholderTextColor={secondaryTextColor}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChangeText('')}
          className='absolute right-3 top-0 h-10 justify-center p-1'
        >
          <X size={16} color={secondaryTextColor} />
        </Pressable>
      )}
    </View>
  );
};

export default SearchBar;
