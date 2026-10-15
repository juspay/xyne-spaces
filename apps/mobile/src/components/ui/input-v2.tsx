import {
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Platform,
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Search, X } from 'lucide-react-native';
import { cn } from '@/src/utils/cn';
import { useBottomSheetAwareHandlers } from '@/src/hooks/useBottomSheetAwareHandlers';

type InputV2Variant = 'default' | 'bottomsheet';
const DEFAULT_INPUT_FONT_SIZE = 14;

export interface InputV2Props extends Omit<
  TextInputProps,
  'value' | 'onChangeText' | 'className' | 'style'
> {
  value: string;
  onChangeText: (text: string) => void;
  inputRef?: Ref<TextInput>;
  withContainer?: boolean;
  variant?: InputV2Variant;
  containerClassName?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputClassName?: string;
  inputStyle?: StyleProp<TextStyle>;
  leftIcon?: ReactNode;
  leftIconSize?: number;
  leftIconColor?: string;
  showClearButton?: boolean;
  clearIconColor?: string;
  clearIconSize?: number;
  rightAccessory?: ReactNode;
  onClear?: () => void;
}

export const InputV2 = ({
  value,
  onChangeText,
  inputRef,
  withContainer = true,
  variant = 'default',
  containerClassName,
  containerStyle,
  inputClassName,
  inputStyle,
  leftIcon,
  leftIconSize = 18,
  leftIconColor,
  showClearButton = true,
  clearIconColor,
  clearIconSize = 16,
  rightAccessory,
  onClear,
  placeholderTextColor,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  ...textInputProps
}: InputV2Props): ReactElement => {
  const isMultiline = textInputProps.multiline === true;
  const localInputRef = useRef<TextInput>(null);
  const [nativeValue, setNativeValue] = useState(value);
  const nativeValueRef = useRef(value);
  const pendingNativeValuesRef = useRef<string[]>([]);
  const { onFocus, onBlur } = useBottomSheetAwareHandlers({
    onFocus: onFocusProp,
    onBlur: onBlurProp,
    isBottomSheetAware: variant === 'bottomsheet',
    inputRef: localInputRef,
  });

  useEffect(() => {
    if (value === nativeValueRef.current) {
      pendingNativeValuesRef.current = [];
      return;
    }

    const pendingIndex = pendingNativeValuesRef.current.indexOf(value);
    if (pendingIndex !== -1) {
      pendingNativeValuesRef.current = pendingNativeValuesRef.current.slice(pendingIndex + 1);
      return;
    }

    pendingNativeValuesRef.current = [];
    nativeValueRef.current = value;
    setNativeValue(value);
  }, [value]);

  const setNativeTextFromInput = useCallback((text: string) => {
    nativeValueRef.current = text;
    pendingNativeValuesRef.current = [...pendingNativeValuesRef.current.slice(-12), text];
    setNativeValue(text);
  }, []);

  const handleChangeText = useCallback(
    (text: string) => {
      setNativeTextFromInput(text);
      onChangeText(text);
    },
    [onChangeText, setNativeTextFromInput],
  );

  const setTextInputRef = useCallback(
    (node: TextInput | null) => {
      localInputRef.current = node;

      if (typeof inputRef === 'function') {
        inputRef(node);
        return;
      }

      if (inputRef) {
        (inputRef as MutableRefObject<TextInput | null>).current = node;
      }
    },
    [inputRef],
  );
  const resolvedLeftIconColor =
    leftIconColor ?? (typeof placeholderTextColor === 'string' ? placeholderTextColor : undefined);
  const leftIconColorProps = resolvedLeftIconColor ? { color: resolvedLeftIconColor } : {};
  const resolvedClearColor =
    clearIconColor ?? (typeof placeholderTextColor === 'string' ? placeholderTextColor : undefined);
  const clearIconColorProps = resolvedClearColor ? { color: resolvedClearColor } : {};
  const variantInputClass =
    variant === 'bottomsheet'
      ? 'bg-bottomsheet-container-bg text-bottomsheet-container-foreground'
      : 'bg-foreground/5 text-foreground';
  const variantTextClass =
    variant === 'bottomsheet' ? 'text-bottomsheet-container-foreground' : 'text-foreground';
  const multilineVerticalPadding = Platform.OS === 'ios' ? 4 : 8;
  const inputNativeStyle: TextStyle = isMultiline
    ? {
        fontSize: DEFAULT_INPUT_FONT_SIZE,
        lineHeight: 20,
        textAlignVertical: 'top',
        includeFontPadding: false,
        paddingTop: multilineVerticalPadding,
        paddingBottom: multilineVerticalPadding,
      }
    : {
        fontSize: DEFAULT_INPUT_FONT_SIZE,
        textAlignVertical: 'center',
        includeFontPadding: false,
        paddingVertical: 0,
      };
  const resolvedInputStyle: StyleProp<TextStyle> = [inputNativeStyle, inputStyle];
  const resolvedScrollEnabled = textInputProps.scrollEnabled ?? isMultiline;
  const hasClearButton = showClearButton && nativeValue.length > 0;
  const hasRightSlot = hasClearButton || Boolean(rightAccessory);
  const hasLeftSlot = isMultiline ? Boolean(leftIcon) : true;
  const multilineInsetStyle = isMultiline ? { paddingTop: 8 } : undefined;
  const singleLineLeftPaddingClass = hasLeftSlot ? 'pl-9' : 'pl-3';
  const singleLineRightPaddingClass = hasRightSlot ? 'pr-10' : 'pr-3';
  const nativeGesture = useMemo(() => Gesture.Native().disallowInterruption(true), []);

  const inputClassNames = cn(
    isMultiline
      ? withContainer
        ? 'flex-1 min-h-10'
        : 'min-h-10'
      : withContainer
        ? 'h-10 w-full'
        : 'h-10',
    !isMultiline && withContainer ? singleLineLeftPaddingClass : undefined,
    !isMultiline && withContainer ? singleLineRightPaddingClass : undefined,
    variantTextClass,
    inputClassName,
  );

  const textInput = (
    <TextInput
      ref={setTextInputRef}
      className={inputClassNames}
      style={resolvedInputStyle}
      value={nativeValue}
      onChangeText={handleChangeText}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholderTextColor={placeholderTextColor}
      {...textInputProps}
      scrollEnabled={resolvedScrollEnabled}
    />
  );

  const textInputNode =
    variant === 'bottomsheet' && Platform.OS === 'ios' ? (
      <GestureDetector gesture={nativeGesture}>{textInput}</GestureDetector>
    ) : (
      textInput
    );

  if (!withContainer) {
    return textInputNode;
  }

  const handleClear = (): void => {
    setNativeTextFromInput('');

    if (onClear) {
      onClear();
      return;
    }

    onChangeText('');
  };

  if (!isMultiline) {
    return (
      <View
        className={cn('relative h-10 rounded-xl', variantInputClass, containerClassName)}
        style={containerStyle}
      >
        {hasLeftSlot && (
          <View
            className='absolute left-3 z-10 justify-center'
            style={{ top: 0, bottom: 0 }}
            pointerEvents='none'
          >
            {leftIcon ?? <Search size={leftIconSize} {...leftIconColorProps} />}
          </View>
        )}

        {textInputNode}

        {hasRightSlot && (
          <View className='absolute right-3 z-10 justify-center' style={{ top: 0, bottom: 0 }}>
            {hasClearButton ? (
              <Pressable
                onPress={handleClear}
                className='h-10 w-10 items-center justify-center rounded-none'
              >
                <X size={clearIconSize} {...clearIconColorProps} />
              </Pressable>
            ) : (
              rightAccessory
            )}
          </View>
        )}
      </View>
    );
  }

  return (
    <View
      className={cn(
        'flex-row px-3 rounded-xl',
        isMultiline ? 'min-h-10 items-start' : 'h-10 items-center',
        variantInputClass,
        containerClassName,
      )}
      style={containerStyle}
    >
      {hasLeftSlot && (
        <View
          className='mr-2 min-w-5 items-center justify-center'
          style={multilineInsetStyle}
          pointerEvents='none'
        >
          {leftIcon ?? <Search size={leftIconSize} {...leftIconColorProps} />}
        </View>
      )}

      {textInputNode}

      {hasRightSlot && (
        <View
          className={cn(
            'ml-2 w-10 items-center',
            isMultiline ? 'justify-start' : 'h-10 justify-center',
          )}
          style={multilineInsetStyle}
        >
          {hasClearButton ? (
            <Pressable
              onPress={handleClear}
              className={cn(
                'h-10 w-10 items-center',
                isMultiline ? 'justify-start' : 'justify-center',
              )}
            >
              <X size={clearIconSize} {...clearIconColorProps} />
            </Pressable>
          ) : (
            rightAccessory
          )}
        </View>
      )}
    </View>
  );
};

export default InputV2;
