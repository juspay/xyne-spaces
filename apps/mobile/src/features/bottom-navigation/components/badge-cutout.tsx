import { useMemo, type ReactElement, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { CutoutView, type CutoutHole } from '@/modules/xyne-cutout';

import { BADGE_HEIGHT, BADGE_OFFSET_RIGHT, BADGE_OFFSET_TOP, ICON_SIZE } from '../constants';

/** Clear space kept between the badge and the icon around it. */
const CUTOUT_GAP = 1.33;
/** The cutout's corner radius: the badge's own plus the gap. */
const CUTOUT_RADIUS = BADGE_HEIGHT / 2 + CUTOUT_GAP;

const NO_HOLES: readonly CutoutHole[] = [];

type BadgeCutoutProps = {
  /** The badge's measured width, or null when the tab shows no badge. */
  badgeWidth: number | null;
  children: ReactNode;
};

/**
 * Erases the icon around its unread badge, so the badge sits in a clean gap
 * rather than on top of the icon's strokes. Whatever is behind the icon — the
 * frosted bar, or the active highlight — shows through the gap.
 *
 * A real cut-out rather than a ring painted in the bar's colour: the bar is
 * translucent and the highlight sits under some tabs, so no single colour
 * could match what is behind the icon.
 *
 * Always the same native view, badge or not, so a count appearing or clearing
 * only changes the hole; with no badge it draws its children as they are.
 */
export function BadgeCutout({ badgeWidth, children }: BadgeCutoutProps): ReactElement {
  const holes = useMemo(
    () => (badgeWidth === null ? NO_HOLES : [cutoutHole(badgeWidth)]),
    [badgeWidth],
  );

  return (
    <CutoutView holes={holes} style={StyleSheet.absoluteFill}>
      {children}
    </CutoutView>
  );
}

/**
 * The rounded hole where the badge sits, in the icon's own coordinates. The
 * badge hangs past the icon's top-right corner, so the hole does too; only the
 * part over the icon is cut.
 */
function cutoutHole(badgeWidth: number): CutoutHole {
  const right = ICON_SIZE - BADGE_OFFSET_RIGHT + CUTOUT_GAP;
  const left = right - badgeWidth - CUTOUT_GAP * 2;
  const top = BADGE_OFFSET_TOP - CUTOUT_GAP;
  const bottom = BADGE_OFFSET_TOP + BADGE_HEIGHT + CUTOUT_GAP;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    radius: Math.min(CUTOUT_RADIUS, (right - left) / 2, (bottom - top) / 2),
  };
}
