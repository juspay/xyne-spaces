import { memo, useCallback, useEffect, useState, type ReactElement } from 'react';
import { Alert, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import { setRichEmailClipboard } from '@/src/utils/richMessageClipboard';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

export type CopyableValueProps = {
  value: string;
  /** When set, inline variant renders `{label}: {value}`. Row variant uses it as a leading label. */
  label?: string;
  variant?: 'inline' | 'row';
  align?: 'left' | 'center';
  monospace?: boolean;
  textClassName?: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
  copyAccessibilityLabel?: string;
  disabled?: boolean;
  showCopiedLabel?: boolean;
  richEmailCopy?: boolean;
};

export const CopyableValue = memo(function CopyableValue({
  value,
  label,
  variant = 'inline',
  align = 'left',
  monospace = false,
  textClassName,
  className,
  style,
  copyAccessibilityLabel,
  disabled = false,
  showCopiedLabel = true,
  richEmailCopy = false,
}: CopyableValueProps): ReactElement | null {
  const [copied, setCopied] = useState(false);
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const { accentText: primaryColor } = useBubbleAccent();
  const trimmedValue = value.trim();

  useEffect((): (() => void) | undefined => {
    if (!copied) return undefined;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return (): void => clearTimeout(timeout);
  }, [copied]);

  const handleCopy = useCallback((): void => {
    if (disabled || !trimmedValue) return;
    void Clipboard.setStringAsync(trimmedValue)
      .then(() => {
        if (richEmailCopy) {
          setRichEmailClipboard(trimmedValue);
        }
        setCopied(true);
        void haptics.success();
      })
      .catch(() => {
        void haptics.error();
        Alert.alert('Unable to copy');
      });
  }, [disabled, richEmailCopy, trimmedValue]);

  if (!trimmedValue) {
    return null;
  }

  const copyButton = (
    <Pressable
      onPress={handleCopy}
      disabled={disabled}
      hitSlop={8}
      className='shrink-0 flex-row items-center gap-1 p-1 active:opacity-60'
      accessibilityRole='button'
      accessibilityLabel={
        copied
          ? 'Copied'
          : (copyAccessibilityLabel ?? (label ? `Copy ${label.toLowerCase()}` : 'Copy'))
      }
    >
      {copied && showCopiedLabel ? (
        <>
          <Check size={14} color={primaryColor} />
          <Text className='text-xs' style={{ color: primaryColor }}>
            Copied
          </Text>
        </>
      ) : (
        <Copy size={14} color={mutedColor} />
      )}
    </Pressable>
  );

  if (variant === 'row') {
    return (
      <View className={cn('flex-row items-center gap-2', className)} style={style}>
        {label ? (
          <Text className='shrink-0 text-sm font-semibold text-foreground'>{label}</Text>
        ) : null}
        <Text
          className={cn(
            'min-w-0 flex-1 text-sm text-foreground',
            monospace && 'font-mono',
            textClassName,
          )}
          numberOfLines={1}
        >
          {trimmedValue}
        </Text>
        {!disabled ? copyButton : null}
      </View>
    );
  }

  const displayText = label ? `${label}: ${trimmedValue}` : trimmedValue;

  return (
    <View
      className={cn(
        'flex-row items-center gap-1.5',
        align === 'center' && 'justify-center',
        className,
      )}
      style={style}
    >
      <Text
        className={cn(
          'min-w-0 shrink text-xs text-secondary-foreground',
          monospace && 'font-mono',
          textClassName,
        )}
        numberOfLines={1}
      >
        {displayText}
      </Text>
      {!disabled ? copyButton : null}
    </View>
  );
});
