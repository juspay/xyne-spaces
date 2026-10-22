import { useEffect, useRef, type ReactElement } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useCSSVariable } from 'uniwind';
import { cn } from '@/src/utils/cn';

/**
 * Android drops a programmatic focus if it lands before the sheet window is
 * ready (caret blinks, keyboard stays down). 300ms is the measured-reliable
 * delay; iOS can focus as soon as `shouldAutoFocus` is true.
 */
const SHEET_FIELD_AUTOFOCUS_DELAY_MS = Platform.OS === 'android' ? 300 : 0;

/** Max characters accepted for a section name across the create/rename sheets. */
export const SECTION_NAME_MAX_LENGTH = 80;

/** The counter stays out of the way until the cap is close enough to matter. */
const COUNTER_VISIBLE_FROM = Math.round(SECTION_NAME_MAX_LENGTH * 0.75);

/**
 * Shared section-name validation: required, length cap, and case-insensitive
 * uniqueness. `currentName` excludes the section's own name while renaming.
 */
export function sectionNameError(
  name: string,
  existingNames: string[],
  currentName: string | null = null,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Section name is required';
  if (trimmed.length > SECTION_NAME_MAX_LENGTH) {
    return `Section name must be ${SECTION_NAME_MAX_LENGTH} characters or less`;
  }
  const isDuplicate = existingNames.some(
    existing => existing !== currentName && existing.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  return isDuplicate ? 'A section with this name already exists' : null;
}

type SectionSheetTextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  maxLength: number;
  error: string | null;
  /** Sits under the field whenever there is no error to show instead. */
  helperText?: string;
  /**
   * Create waits until the gorhom sheet reports an open index; rename is true
   * from mount of the overlay.
   */
  shouldAutoFocus?: boolean;
  prefix?: ReactElement | null;
  onSubmitEditing?: () => void;
};

export function SectionSheetTextField({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  error,
  helperText,
  shouldAutoFocus = false,
  prefix,
  onSubmitEditing,
}: SectionSheetTextFieldProps): ReactElement {
  const placeholderColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!shouldAutoFocus) return;
    const timeout = setTimeout(() => inputRef.current?.focus(), SHEET_FIELD_AUTOFOCUS_DELAY_MS);
    return (): void => clearTimeout(timeout);
  }, [shouldAutoFocus]);

  return (
    <View className='gap-1.5'>
      <Text className='text-xs font-semibold text-bottomsheet-container-foreground'>{label}</Text>
      <View
        className={cn(
          'h-12 flex-row items-center rounded-xl border bg-bottomsheet-container-bg px-3',
          error ? 'border-status-danger' : 'border-transparent',
        )}
      >
        {prefix ?? null}
        <BottomSheetTextInput
          // gorhom types this ref as gesture-handler's TextInput *component*
          // rather than an instance. The runtime value is the RN input.
          ref={inputRef as never}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={placeholderColor}
          maxLength={maxLength}
          autoCapitalize='none'
          autoCorrect={false}
          returnKeyType='done'
          onSubmitEditing={onSubmitEditing}
          className='flex-1 text-foreground'
          style={{
            fontSize: 15,
            paddingVertical: 0,
            textAlignVertical: 'center',
            includeFontPadding: false,
          }}
        />
        {value.length >= COUNTER_VISIBLE_FROM && (
          <Text className='ml-2 text-[11px] font-medium text-bottomsheet-text-muted'>
            {value.length}/{maxLength}
          </Text>
        )}
      </View>
      {error ? (
        <Text className='text-sm text-status-danger'>{error}</Text>
      ) : helperText ? (
        <Text className='text-xs text-bottomsheet-text-muted'>{helperText}</Text>
      ) : null}
    </View>
  );
}
