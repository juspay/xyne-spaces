import type { ReactElement } from 'react';

/**
 * Where the link under the pointer goes, in the page's bottom corner, as every
 * browser shows it. It takes no pointer, so it never gets in the way of the page.
 */
export function LinkPreview(props: {
  url: string;
  /** The page's box on screen. */
  page: { left: number; top: number; width: number; height: number };
}): ReactElement | null {
  if (!props.url) return null;
  return (
    <div
      aria-hidden='true'
      className='pointer-events-none fixed z-[3] truncate rounded-md border border-border bg-popover px-2 py-0.5 text-[11.5px] text-popover-foreground shadow-sm'
      style={{
        left: props.page.left + 6,
        top: props.page.top + props.page.height - 28,
        maxWidth: Math.max(160, props.page.width / 2),
      }}
    >
      {props.url}
    </div>
  );
}
