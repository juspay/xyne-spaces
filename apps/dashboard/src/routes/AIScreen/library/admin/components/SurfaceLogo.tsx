import type { ReactElement } from 'react';
import { cn } from '@/utils/classNames';

const SURFACE = {
  spaces: { src: '/assets/mcp/xyne-spaces.svg', scale: '' },
  slack: { src: '/assets/mcp/slack.png', scale: 'scale-[1.6]' },
} as const;

export function SurfaceLogo({
  surface,
  label,
  className,
}: {
  surface: keyof typeof SURFACE;
  label: string;
  className?: string;
}): ReactElement {
  const { src, scale } = SURFACE[surface];
  return (
    <img
      src={src}
      alt={label}
      className={cn('shrink-0 object-contain', className ?? 'size-4', scale)}
    />
  );
}
