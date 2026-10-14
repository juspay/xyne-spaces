import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Search } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { InputV2 } from '@/src/components/ui/input-v2';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';
import { FilterSheetHeader } from './filter-sheet-header';

/** Same measured Android show-soft-input delay the main search input uses. */
const SHEET_AUTOFOCUS_DELAY_MS = 300;

type FilterMultiSelectSheetProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  title: string;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  selectionCount: number;
  /** Commit the draft. The sheet dismisses itself afterwards. */
  onApply: () => void;
  /** Drop every selection. The sheet dismisses itself afterwards. */
  onClear: () => void;
  children: ReactNode;
};

/**
 * Chrome shared by the From and In filter sheets: fullscreen sheet, Cancel /
 * title / Apply header, search box, a selection summary with Clear, and the
 * list slot.
 *
 * The actions sit at the top rather than in a sticky footer — under
 * `keyboardBehavior='extend'` a footer needs KeyboardStickyView gymnastics to
 * stay reachable, whereas the top of the sheet is keyboard-safe by
 * construction.
 */
export function FilterMultiSelectSheet({
  isOpen,
  onOpenChange,
  onDismiss,
  title,
  searchPlaceholder,
  query,
  onQueryChange,
  selectionCount,
  onApply,
  onClear,
  children,
}: FilterMultiSelectSheetProps): ReactElement {
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const inputRef = useRef<TextInput>(null);
  const { accentText } = useBubbleAccent();
  const placeholderColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;

  const dismissSheet = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), SHEET_AUTOFOCUS_DELAY_MS);
    return (): void => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissSheet();
      return true;
    });
    return (): void => subscription.remove();
  }, [dismissSheet]);

  const handleApply = useCallback(() => {
    void haptics.buttonTap();
    onApply();
    dismissSheet();
  }, [dismissSheet, onApply]);

  const handleClear = useCallback(() => {
    void haptics.buttonTap();
    onClear();
    dismissSheet();
  }, [dismissSheet, onClear]);

  return (
    // No open/close haptic here — AppBottomSheet already fires one.
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      mode='fullscreen'
      keyboardBehavior='extend'
      backdropOpacity={0.4}
    >
      <FilterSheetHeader title={title} onCancel={dismissSheet} onApply={handleApply} />

      <View className='mt-3 flex-1 px-4' style={{ minHeight: 0 }}>
        <InputV2
          inputRef={inputRef}
          value={query}
          onChangeText={onQueryChange}
          variant='bottomsheet'
          placeholder={searchPlaceholder}
          placeholderTextColor={placeholderColor}
          leftIcon={<Search size={18} color={placeholderColor} />}
          clearIconColor={placeholderColor}
          autoCapitalize='none'
          autoCorrect={false}
          returnKeyType='search'
          inputClassName='font-medium'
        />

        {selectionCount > 0 ? (
          <View className='flex-row items-center justify-between px-1 pb-0.5 pt-3'>
            <Text className='text-[13px] text-bottomsheet-text-muted'>
              {selectionCount} selected
            </Text>
            <Pressable
              accessibilityRole='button'
              hitSlop={8}
              onPress={handleClear}
              className='active:opacity-60'
            >
              <Text className='text-[13px] font-medium' style={{ color: accentText }}>
                Clear
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View className='mt-2 flex-1' style={{ minHeight: 0 }}>
          {children}
        </View>
      </View>
    </AppBottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Shared list ordering
// ---------------------------------------------------------------------------

/**
 * Orders a picker list selection-first.
 *
 * Both filter sheets read a hook that returns a *truncated* slice on an empty
 * query (25 people, 40 conversations), so an already-selected entry can fall
 * outside it and become impossible to deselect. `missing` carries those
 * entries, synthesized back from the committed chips by the caller.
 *
 * Only meaningful with no query — a typed query is the user's own ordering.
 */
export function selectionFirst<T extends { id: string }>(
  items: readonly T[],
  selectedIds: ReadonlySet<string>,
  missing: readonly T[],
): T[] {
  return [
    ...missing,
    ...items.filter(item => selectedIds.has(item.id)),
    ...items.filter(item => !selectedIds.has(item.id)),
  ];
}
