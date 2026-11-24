import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Search } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  createDebouncedCommitter,
  SEARCH_COMMIT_MAX_WAIT_MS,
  SEARCH_COMMIT_WAIT_MS,
} from '@/src/features/global-search/utils/debounced-commit';
import { haptics } from '@/src/utils/haptics';

import {
  FIND_ANDROID_FOCUS_DELAY_MS,
  FIND_CANCEL_PADDING_X,
  FIND_FIELD_FONT_SIZE,
  FIND_FIELD_GAP,
  FIND_FIELD_HEIGHT,
  FIND_FIELD_ICON_SIZE,
  FIND_FIELD_LETTER_SPACING,
  FIND_FIELD_PADDING_X,
  MESSAGE_BODY_LINE_HEIGHT,
} from '../constants';
import { colorOf } from '../model/token-color';

type FindFieldProps = {
  placeholder: string;
  /** Read once, when the field mounts: the debounce holds on to it. */
  onQueryCommit: (query: string) => void;
  onCancel: () => void;
};

/**
 * The header's find field and its Cancel. What is being typed stays here, and
 * reaches the room only through the global search's debounce (a quiet period
 * with a ceiling), so a keystroke never re-renders the room and its list.
 */
export function FindField({ placeholder, onQueryCommit, onCancel }: FindFieldProps): ReactElement {
  const foreground = colorOf(useCSSVariable('--color-spaces-foreground'));
  const subtle = colorOf(useCSSVariable('--color-spaces-subtle'));
  const accent = colorOf(useCSSVariable('--color-spaces-accent'));
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState('');
  const [committer] = useState(() =>
    createDebouncedCommitter(onQueryCommit, {
      waitMs: SEARCH_COMMIT_WAIT_MS,
      maxWaitMs: SEARCH_COMMIT_MAX_WAIT_MS,
    }),
  );

  useEffect(() => (): void => committer.cancel(), [committer]);
  // Find opens to type into, so the keyboard comes up with the field. Android
  // drops the keyboard of a focus asked for before the window settles, so it
  // waits as global search's field does.
  useEffect(() => {
    if (Platform.OS !== 'android') {
      inputRef.current?.focus();
      return undefined;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), FIND_ANDROID_FOCUS_DELAY_MS);
    return (): void => clearTimeout(timer);
  }, []);
  const handleChangeText = useCallback(
    (next: string): void => {
      setText(next);
      // Cleared: the results go at once rather than after the quiet period.
      if (next.trim().length === 0) {
        committer.cancel();
        onQueryCommit('');
        return;
      }
      committer.push(next);
    },
    [committer, onQueryCommit],
  );

  return (
    <>
      <View
        className='min-w-0 flex-1 flex-row items-center overflow-hidden rounded-full bg-spaces-surface'
        style={{
          height: FIND_FIELD_HEIGHT,
          paddingHorizontal: FIND_FIELD_PADDING_X,
          columnGap: FIND_FIELD_GAP,
        }}
      >
        <Search size={FIND_FIELD_ICON_SIZE} color={subtle} />
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={handleChangeText}
          onSubmitEditing={committer.flush}
          accessibilityLabel={placeholder}
          placeholder={placeholder}
          placeholderTextColor={subtle}
          selectionColor={accent}
          returnKeyType='search'
          autoCorrect={false}
          autoCapitalize='none'
          clearButtonMode='while-editing'
          style={[styles.input, { color: foreground }]}
        />
      </View>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Cancel find'
        onPressIn={() => void haptics.buttonTap()}
        onPress={onCancel}
        className='justify-center active:opacity-60'
        style={{ height: FIND_FIELD_HEIGHT, paddingHorizontal: FIND_CANCEL_PADDING_X }}
      >
        <Text className='text-[16px] leading-[22px] tracking-[-0.176px] text-spaces-read-more'>
          Cancel
        </Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  // Figma Type/Body. A line height on a one-line iOS field shifts the words off
  // centre, so only Android, which needs it to drop its font padding, gets one.
  input: {
    flex: 1,
    height: '100%',
    padding: 0,
    fontSize: FIND_FIELD_FONT_SIZE,
    letterSpacing: FIND_FIELD_LETTER_SPACING,
    ...Platform.select({
      android: {
        includeFontPadding: false,
        lineHeight: MESSAGE_BODY_LINE_HEIGHT,
        textAlignVertical: 'center',
      },
      default: {},
    }),
  },
});
