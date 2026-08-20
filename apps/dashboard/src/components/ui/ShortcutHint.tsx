import type { ReactElement } from 'react';
import { cn } from '../../utils/classNames';
import { usePlatform } from '../../hooks/usePlatform';
import { formatShortcut } from '../../shortcuts';

interface ShortcutHintProps {
  keys: string;
  className?: string;
}

export const ShortcutHint = ({ keys, className }: ShortcutHintProps): ReactElement | null => {
  const { isMobile, isMac } = usePlatform();

  if (isMobile) return null;

  return (
    <span aria-hidden='true' className={cn('opacity-60 tabular-nums', className)}>
      {formatShortcut(keys, isMac)}
    </span>
  );
};

export default ShortcutHint;
