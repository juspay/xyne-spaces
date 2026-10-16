import type { ReactElement, ReactNode } from 'react';
import { Pressable } from 'react-native';

import { haptics } from '@/src/utils/haptics';

export const IconButton = ({
  label,
  onPress,
  disabled = false,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: ReactNode;
}): ReactElement => (
  <Pressable
    accessibilityRole='button'
    accessibilityLabel={label}
    hitSlop={8}
    disabled={disabled}
    onPress={(): void => {
      void haptics.buttonTap();
      onPress();
    }}
    className={`p-1 active:opacity-60 ${disabled ? 'opacity-40' : ''}`}
  >
    {children}
  </Pressable>
);
