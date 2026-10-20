import { type ReactElement, type ReactNode } from 'react';
import { Pressable } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { cn } from '@/src/utils/cn';

type HeaderButtonProps = {
  label: string;
  size: number;
  onPress: () => void;
  children: ReactNode;
  className?: string;
};

/** A square-hit-area header button; the caller draws the icon. */
export function HeaderButton({
  label,
  size,
  onPress,
  children,
  className,
}: HeaderButtonProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPressIn={() => void haptics.buttonTap()}
      onPress={onPress}
      className={cn('items-center justify-center rounded-full active:opacity-60', className)}
      style={{ width: size, height: size }}
    >
      {children}
    </Pressable>
  );
}
