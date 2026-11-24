import { memo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { cn } from '@/src/utils/cn';

import { SCHEDULE_TRAY_BUTTON_HEIGHT } from '../constants';

type TrayActionButtonProps = {
  label: string;
  /** `primary`: the accent pill that commits; `quiet`: a muted text button beside it. */
  tone: 'primary' | 'quiet';
  onPress: () => void;
  disabled?: boolean;
};

/** A full-width, 48 tall button at the foot of a tray step. */
export const TrayActionButton = memo(function TrayActionButton({
  label,
  tone,
  onPress,
  disabled = false,
}: TrayActionButtonProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'items-center justify-center rounded-full active:opacity-70',
        tone === 'primary' ? 'bg-spaces-accent' : '',
        disabled ? 'opacity-60' : '',
      )}
      style={styles.button}
    >
      <Text
        className={cn(
          'text-[16px] leading-[22px]',
          tone === 'primary' ? 'font-medium text-spaces-accent-foreground' : 'text-spaces-muted',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: { height: SCHEDULE_TRAY_BUTTON_HEIGHT },
});
