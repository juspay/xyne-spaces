import { memo, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';

import { BUTTON_CONTAINER_CLASS, BUTTON_SIZE_CLASS, BUTTON_TEXT_CLASS } from './button.theme';
import type { ButtonProps, ButtonVariant } from './button.types';

const BUTTON_TEXT_COLOR_VAR: Record<ButtonVariant, string> = {
  primary: '--color-button-primary-text',
  secondary: '--color-button-secondary-text',
  warning: '--color-button-warning-text',
  danger: '--color-button-danger-text',
};

const ButtonComponent = ({
  label,
  variant = 'secondary',
  size = 'md',
  loading = false,
  readOnly = false,
  disabled = false,
  className,
  textClassName,
  style,
  onPress,
  accessibilityLabel,
  ...rest
}: ButtonProps): ReactElement => {
  const disabledOpacity = Number(useCSSVariable('--color-button-disabled-opacity') ?? 0.55);
  const themeSpinnerColor = useCSSVariable(BUTTON_TEXT_COLOR_VAR[variant]) as string;
  const { accentBg, accentFg } = useBubbleAccent();
  const isDanger = variant === 'danger';
  const spinnerColor = isDanger ? accentFg : themeSpinnerColor;
  const isInteractive = !readOnly && typeof onPress === 'function';
  const isDisabled = disabled || loading;
  const sizeClass = BUTTON_SIZE_CLASS[size];
  const dangerPaint = isDanger ? { backgroundColor: accentBg, borderColor: accentBg } : null;

  const containerClassName = cn(
    'max-w-full min-w-0 shrink self-start rounded-md border',
    readOnly ? 'border-dashed' : 'border-solid',
    BUTTON_CONTAINER_CLASS[variant],
    sizeClass.container,
    className,
  );

  const labelClassName = cn(
    'font-semibold',
    variant === 'primary' && isInteractive ? 'font-bold' : '',
    BUTTON_TEXT_CLASS[variant],
    sizeClass.text,
    textClassName,
  );

  const content = (
    <View className='flex-row items-center gap-2'>
      {loading ? <ActivityIndicator size='small' color={spinnerColor} /> : null}
      <Text className={labelClassName} {...(isDanger ? { style: { color: accentFg } } : {})}>
        {label}
      </Text>
    </View>
  );

  const resolvedStyle = [
    dangerPaint,
    style,
    isDisabled || readOnly ? { opacity: disabledOpacity } : null,
  ];

  if (!isInteractive) {
    return (
      <View
        accessible
        accessibilityRole='text'
        accessibilityLabel={accessibilityLabel ?? `${label}. Read-only button.`}
        className={containerClassName}
        style={resolvedStyle}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={4}
      onPress={onPress}
      className={containerClassName}
      style={({ pressed }) => [...resolvedStyle, pressed && !isDisabled ? { opacity: 0.8 } : null]}
      {...rest}
    >
      {content}
    </Pressable>
  );
};

const Button = memo(ButtonComponent);
Button.displayName = 'Button';

export { Button };
