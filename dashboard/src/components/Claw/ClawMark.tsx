import type { ReactElement } from 'react';
import { cn } from '../../utils/classNames';

interface ClawMarkProps {
  size?: number;
  className?: string;
}

export function ClawMark({ size = 20, className }: ClawMarkProps): ReactElement {
  return (
    <img
      src='/images/xyne_logo.png'
      alt=''
      aria-hidden='true'
      draggable={false}
      width={size}
      height={size}
      className={cn('shrink-0 select-none object-contain', className)}
    />
  );
}
