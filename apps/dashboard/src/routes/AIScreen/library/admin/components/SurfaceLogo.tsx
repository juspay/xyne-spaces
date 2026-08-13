import type { ReactElement } from 'react';
import { cn } from '@/utils/classNames';

/**
 * slack.png bakes ~19% transparent padding into each edge, so its mark renders
 * noticeably smaller than xyne-spaces.svg at the same box size. Scale it up to
 * match optically — transform keeps the layout box unchanged.
 */
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
