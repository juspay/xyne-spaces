import { useMemo, type ReactElement, type ReactNode } from 'react';
import { Pressable } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { cn } from '@/src/utils/cn';

type IconButtonProps = {
  label: string;
  size: number;
  onPress: () => void;
  /** The icon, drawn by the caller: a bare 20, or a 16 on a plate (`className='bg-spaces-surface'`). */
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** For a button that opens a panel: whether that panel is showing. */
  expanded?: boolean;
};

/** Figma "Button / Icon": a round, square-hit-area button with a tap haptic. */
export function IconButton({
  label,
  size,
  onPress,
  children,
  className,
  disabled = false,
  expanded,
}: IconButtonProps): ReactElement {
  const style = useMemo(() => ({ width: size, height: size }), [size]);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      {...(expanded === undefined ? {} : { accessibilityState: { expanded } })}
      disabled={disabled}
      onPressIn={() => void haptics.buttonTap()}
      onPress={onPress}
      className={cn(
        'items-center justify-center rounded-full active:opacity-60',
        disabled && 'opacity-40',
        className,
      )}
      style={style}
    >
      {children}
    </Pressable>
  );
}
