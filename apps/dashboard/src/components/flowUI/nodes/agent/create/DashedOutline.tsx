import type { ReactElement } from 'react';
import { cn } from '@/utils/classNames';

/**
 * Dashed 0.8px outline with 4px dashes and 4px gaps, drawn as SVG over a
 * `relative` parent. CSS `border-dashed` at this width renders as near-dots,
 * so the "+ Add" chip and suggested capability pills both use this instead.
 */
export function DashedOutline({
  radius = 12,
  className,
}: {
  /** The parent's border radius in px. */
  radius?: number;
  className?: string;
}): ReactElement {
  return (
    <svg
      aria-hidden
      // overflow-visible: the parent's width is often fractional (it fits its text), and
      // the SVG box rounds down, which clipped the right-hand stroke and corners.
      className={cn(
        'pointer-events-none absolute inset-0 size-full overflow-visible text-border',
        className,
      )}
      fill='none'
    >
      <rect
        x='0.4'
        y='0.4'
        width='calc(100% - 0.8px)'
        height='calc(100% - 0.8px)'
        // Half the stroke in from the edge, so the dashes sit on the rounded corner.
        rx={radius - 0.4}
        stroke='currentColor'
        strokeWidth='0.8'
        strokeDasharray='4 4'
      />
    </svg>
  );
}
