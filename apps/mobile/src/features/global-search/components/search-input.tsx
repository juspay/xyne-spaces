import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { Search, X } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { haptics } from '@/src/utils/haptics';
import { withAlpha } from '@/src/utils/color';
import { SearchFilterChipView } from './search-filter-chip';
import {
  createDebouncedCommitter,
  SEARCH_COMMIT_MAX_WAIT_MS,
  SEARCH_COMMIT_WAIT_MS,
} from '../utils/debounced-commit';
import type { SearchDispatch } from '../hooks/use-search-state';
import {
  detectFilterTrigger,
  stripActiveTrigger,
  toFreeText,
  triggersEqual,
  type FilterTrigger,
} from '../utils/filter-trigger';
import { scopedPlaceholder } from '../utils/scope';
import {
  SEARCH_BAR_HEIGHT,
  SEARCH_BAR_ICON_SIZE,
  SEARCH_BAR_TEXT_FONT_SIZE,
  SEARCH_BAR_TEXT_LINE_HEIGHT,
  SEARCH_SIDE_MARGIN,
} from '../constants';
import { filterChipTitle, placeholderForTab, type GlobalSearchTab } from '../utils/search-tabs';
import type { SearchFilterChip, SearchScope } from '../types';

/**
 * Android sends no backspace key event to an empty TextInput, so with only chips left
 * there is nothing to hang "backspace removes the last chip" off. One zero-width space
 * keeps the field non-empty — deleting it surfaces as an onChangeText to empty, which
 * is the signal.
 */
const EMPTY_CARET = '​';

/**
 * Android drops the show-soft-input that rides along with a programmatic focus if it
 * arrives before the incoming screen's window is ready. Measured on device: immediate
 * 1/5, runAfterInteractions 2/5, a 300ms timer 5/5. iOS has no such gap.
 */
const ANDROID_AUTOFOCUS_DELAY_MS = 300;

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: SEARCH_SIDE_MARGIN },
  scroll: { flex: 1 },
  scrollContent: { alignItems: 'center', flexGrow: 1 },
});

export type SearchInputHandle = {
  focus: () => void;
  blur: () => void;
  /** Removes the half-typed `from:` / `in:` once its chip has been picked. */
  resolveTrigger: () => void;
};

export type SearchInputProps = {
  ref?: Ref<SearchInputHandle>;
  tab: GlobalSearchTab;
  chips: readonly SearchFilterChip[];
  scope: SearchScope | null;
  dispatch: SearchDispatch;
  onRequestClose: () => void;
};

/**
 * The search pill.
 *
 * The text being typed is local state, so a keystroke re-renders this component and
 * nothing else. The screen hears about it twice, both rarely: the debounced query, and
 * the `from:` / `in:` trigger, which stays `null` for ordinary text.
 *
 * The field is controlled on purpose. Under Fabric there is no supported way to push
 * text into an uncontrolled field, and picking a `from:` suggestion has to rewrite it.
 */
export const SearchInput = memo(function SearchInput({
  ref,
  tab,
  chips,
  scope,
  dispatch,
  onRequestClose,
}: SearchInputProps): ReactElement {
  const inputRef = useRef<TextInput>(null);

  const [draft, setDraft] = useState('');
  // Handlers read the text from here: native events can arrive faster than renders.
  const draftRef = useRef('');
  const triggerRef = useRef<FilterTrigger | null>(null);
  const hasChips = chips.length > 0;

  const inputColor = useCSSVariable('--color-input') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable('--color-secondary-text') as string;
  const { theme } = useUniwind();

  // Driven from the change handler, never from an effect, and `maxWaitMs` commits even
  // while the user keeps typing. Together they stop continuous typing from never
  // searching.
  const committerRef = useRef<ReturnType<typeof createDebouncedCommitter<string>> | null>(null);
  if (committerRef.current === null) {
    committerRef.current = createDebouncedCommitter<string>(
      text => dispatch({ type: 'queryCommitted', query: toFreeText(text) }),
      { waitMs: SEARCH_COMMIT_WAIT_MS, maxWaitMs: SEARCH_COMMIT_MAX_WAIT_MS },
    );
  }
  const committer = committerRef.current;

  useEffect(() => (): void => committer.cancel(), [committer]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      inputRef.current?.focus();
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), ANDROID_AUTOFOCUS_DELAY_MS);
    return (): void => clearTimeout(timer);
  }, []);

  const writeDraft = useCallback(
    (text: string) => {
      draftRef.current = text;
      setDraft(text);

      // Reported only when it changes, so ordinary typing never reaches the screen.
      const trigger = detectFilterTrigger(text);
      if (!triggersEqual(trigger, triggerRef.current)) {
        triggerRef.current = trigger;
        dispatch({ type: 'triggerChanged', trigger });
      }
    },
    [dispatch],
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: (): void => inputRef.current?.focus(),
      blur: (): void => inputRef.current?.blur(),
      resolveTrigger: (): void => {
        const text = stripActiveTrigger(draftRef.current);
        // The user has finished choosing, so there is nothing left to debounce.
        committer.cancel();
        writeDraft(text);
        dispatch({ type: 'queryCommitted', query: toFreeText(text) });
      },
    }),
    [committer, dispatch, writeDraft],
  );

  const onChangeText = useCallback(
    (raw: string) => {
      const text = raw.replaceAll(EMPTY_CARET, '');

      // Android: deleting the sentinel is the only backspace signal available.
      if (
        Platform.OS === 'android' &&
        text.length === 0 &&
        draftRef.current.length === 0 &&
        hasChips
      ) {
        dispatch({ type: 'lastChipRemoved' });
        return;
      }

      writeDraft(text);
      committer.push(text);
    },
    [committer, dispatch, hasChips, writeDraft],
  );

  // iOS does deliver the key event on an empty field, so it needs no sentinel.
  const onKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (Platform.OS !== 'ios') return;
      if (event.nativeEvent.key !== 'Backspace') return;
      if (draftRef.current.length > 0) return;
      dispatch({ type: 'lastChipRemoved' });
    },
    [dispatch],
  );

  /** Enter should search now rather than wait out the debounce. */
  const onSubmitEditing = useCallback(() => {
    committer.flush();
    Keyboard.dismiss();
  }, [committer]);

  const removeChip = useCallback(
    (chip: SearchFilterChip) => dispatch({ type: 'chipRemoved', chip }),
    [dispatch],
  );

  /** Clears the text and the chips; closes the screen when there is nothing to clear. */
  const onClearPress = useCallback(() => {
    void haptics.buttonTap();

    if (draftRef.current.length > 0 || hasChips) {
      committer.cancel();
      writeDraft('');
      dispatch({ type: 'cleared' });
      return;
    }

    inputRef.current?.blur();
    onRequestClose();
  }, [committer, dispatch, hasChips, onRequestClose, writeDraft]);

  /** See EMPTY_CARET — the sentinel only exists while chips are the sole content. */
  const inputValue =
    Platform.OS === 'android' && draft.length === 0 && hasChips ? EMPTY_CARET : draft;

  const placeholder = useMemo(() => {
    if (hasChips) return '';
    return scope ? scopedPlaceholder(scope) : placeholderForTab(tab);
  }, [hasChips, scope, tab]);

  const pillStyle = useMemo(
    () => ({
      height: SEARCH_BAR_HEIGHT,
      backgroundColor: inputColor,
      borderColor: withAlpha(foregroundColor, theme === 'dark' ? 0.08 : 0.06),
      borderWidth: StyleSheet.hairlineWidth,
    }),
    [foregroundColor, inputColor, theme],
  );

  const textStyle = useMemo(
    () => [
      {
        color: foregroundColor,
        fontSize: SEARCH_BAR_TEXT_FONT_SIZE,
        height: '100%' as const,
        minWidth: hasChips ? 96 : 120,
        paddingVertical: 0,
      },
      Platform.select({
        android: {
          includeFontPadding: false,
          lineHeight: SEARCH_BAR_TEXT_LINE_HEIGHT,
          textAlignVertical: 'center' as const,
        },
      }),
    ],
    [foregroundColor, hasChips],
  );

  return (
    <View style={styles.wrapper}>
      <View
        className='flex-row items-center gap-2 overflow-hidden rounded-full px-3'
        style={pillStyle}
      >
        <Search size={SEARCH_BAR_ICON_SIZE} color={mutedColor} />

        {/*
          Nothing here may be sized against SEARCH_BAR_HEIGHT. The pill is 44pt
          *including* its hairline border, so its content box is ~43.3pt — a flat 44
          made contentSize taller than the frame, and `horizontal` only picks the
          default bounce axis, it does not lock the vertical one. The result was a
          sub-pixel but grabbable vertical scroll. `flexGrow: 1` fills the frame
          instead, whatever the border costs.
        */}
        <ScrollView
          horizontal
          alwaysBounceVertical={false}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps='always'
          contentContainerStyle={styles.scrollContent}
          style={styles.scroll}
        >
          {chips.map(chip => (
            <SearchFilterChipView
              key={`${chip.prefix}-${chip.id}`}
              chip={chip}
              prefixLabel={filterChipTitle(chip.prefix, tab)}
              onRemove={removeChip}
            />
          ))}

          <TextInput
            ref={inputRef}
            value={inputValue}
            onChangeText={onChangeText}
            onKeyPress={onKeyPress}
            onSubmitEditing={onSubmitEditing}
            placeholder={placeholder}
            placeholderTextColor={mutedColor}
            returnKeyType='search'
            autoCorrect={false}
            autoCapitalize='none'
            className='min-w-[120px] flex-1 self-stretch p-0'
            style={textStyle}
          />
        </ScrollView>

        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Clear search'
          hitSlop={10}
          onPress={onClearPress}
        >
          <X size={20} color={mutedColor} />
        </Pressable>
      </View>
    </View>
  );
});
