import { useCSSVariable } from 'uniwind';

import { withAlpha } from '@/src/utils/color';

/**
 * The hairline that lifts a floating surface off the screen behind it.
 *
 * A menu and a tray are both filled with the screen's own background, so
 * without an edge they dissolve into it. Shared so the two read as one family.
 */
export const OVERLAY_BORDER_WIDTH = 0.3;

const OVERLAY_BORDER_ALPHA = 0.16;

export function useOverlayBorderColor(): string {
  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  return withAlpha(foreground, OVERLAY_BORDER_ALPHA);
}
