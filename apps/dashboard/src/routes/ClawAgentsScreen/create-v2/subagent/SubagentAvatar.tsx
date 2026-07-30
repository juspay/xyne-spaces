import { type ReactElement } from 'react';
import { Ai03 } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import type { SubagentSource } from '@/services/claw/clawSubagentsTypes';

const SIZE: Record<'sm' | 'lg', string> = {
  sm: 'size-7 rounded-lg',
  lg: 'size-11 rounded-xl',
};

const GLYPH: Record<'sm' | 'lg', string> = {
  sm: 'size-4',
  lg: 'size-5',
};

export function SubagentAvatar({
  source,
  size = 'sm',
}: {
  source: SubagentSource;
  size?: 'sm' | 'lg';
}): ReactElement {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center border',
        SIZE[size],
        source === 'builtin'
          ? 'border-border bg-muted text-muted-foreground'
          : 'border-primary/20 bg-primary/10 text-primary',
      )}
      aria-hidden
    >
      <Ai03 className={GLYPH[size]} />
    </span>
  );
}
