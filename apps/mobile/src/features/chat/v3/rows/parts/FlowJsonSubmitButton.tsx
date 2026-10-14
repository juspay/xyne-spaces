import { type ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { FlowAction } from '@xyne/shared';
import { listFlowActionButtons } from '@/src/utils/flowAction';

import { stripMarkdownSyntax } from './flowState';

const buttonChrome = (
  variant: string,
  live: boolean,
  bodyTextColor: string,
): { borderColor: string; textColor: string } => {
  if (!live) {
    return { borderColor: '#9ca3af', textColor: bodyTextColor };
  }
  if (variant === 'destructive') {
    return { borderColor: '#b91c1c', textColor: '#b91c1c' };
  }
  if (variant === 'primary') {
    return { borderColor: bodyTextColor, textColor: bodyTextColor };
  }
  return { borderColor: '#6b7280', textColor: bodyTextColor };
};

const buttonBaseStyle = (
  chrome: ReturnType<typeof buttonChrome>,
  live: boolean,
  disabled: boolean,
): ViewStyle => ({
  alignSelf: 'flex-start',
  maxWidth: '100%',
  flexShrink: 1,
  minWidth: 0,
  borderWidth: 1,
  borderColor: chrome.borderColor,
  borderStyle: live ? 'solid' : 'dashed',
  borderRadius: 6,
  backgroundColor: 'transparent',
  paddingHorizontal: 10,
  paddingVertical: 7,
  opacity: live && disabled ? 0.55 : 1,
});

export const FlowJsonSubmitButton = ({
  label,
  variant,
  live,
  disabled,
  submitting,
  bodyTextColor,
  style,
  onPress,
}: {
  label: string;
  variant: string;
  live: boolean;
  disabled: boolean;
  submitting: boolean;
  bodyTextColor: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}): ReactElement => {
  const chrome = buttonChrome(variant, live, bodyTextColor);
  const labelRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {live && submitting ? <ActivityIndicator size='small' color={chrome.textColor} /> : null}
      <Text
        style={{
          fontSize: 14,
          lineHeight: 19,
          fontWeight: live && variant === 'primary' ? '700' : '600',
          color: chrome.textColor,
        }}
      >
        {label}
      </Text>
    </View>
  );

  if (!live) {
    return <View style={[buttonBaseStyle(chrome, live, disabled), style]}>{labelRow}</View>;
  }

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: submitting }}
      disabled={disabled}
      hitSlop={4}
      onPressIn={event => event.stopPropagation()}
      onPress={event => {
        event.stopPropagation();
        if (!disabled && onPress) {
          onPress();
        }
      }}
      style={({ pressed }) => [
        buttonBaseStyle(chrome, live, disabled),
        style,
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      {labelRow}
    </Pressable>
  );
};

export const FlowJsonActionButtonRow = ({
  buttons,
  canPressButtons,
  isSubmitting,
  bodyTextColor,
  executeAction,
}: {
  buttons: ReturnType<typeof listFlowActionButtons>;
  canPressButtons: boolean;
  isSubmitting: boolean;
  bodyTextColor: string;
  executeAction: (action: FlowAction) => Promise<void>;
}): ReactElement | null => {
  if (buttons.length === 0) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      {buttons.map(button => (
        <FlowJsonSubmitButton
          key={button.key}
          label={stripMarkdownSyntax(button.label)}
          variant={button.variant}
          live={canPressButtons}
          disabled={isSubmitting}
          submitting={isSubmitting}
          bodyTextColor={bodyTextColor}
          {...(canPressButtons ? { onPress: () => void executeAction(button.action) } : {})}
        />
      ))}
    </View>
  );
};
