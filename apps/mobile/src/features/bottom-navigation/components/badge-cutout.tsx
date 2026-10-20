import MaskedView from '@react-native-masked-view/masked-view';
import { type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { BADGE_HEIGHT, BADGE_OFFSET_RIGHT, BADGE_OFFSET_TOP, ICON_SIZE } from '../constants';

/** Clear space kept between the badge and the icon around it. */
const CUTOUT_GAP = 1.33;
/** The cutout's corner radius: the badge's own plus the gap. */
const CUTOUT_RADIUS = BADGE_HEIGHT / 2 + CUTOUT_GAP;

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
 * A mask rather than a ring painted in the bar's colour: the bar is
 * translucent and the highlight sits under some tabs, so no single colour
 * could match what is behind the icon.
 */
export function BadgeCutout({ badgeWidth, children }: BadgeCutoutProps): ReactElement {
  if (badgeWidth === null) return <View style={StyleSheet.absoluteFill}>{children}</View>;

  return (
    <MaskedView
      style={StyleSheet.absoluteFill}
      maskElement={
        <Svg width={ICON_SIZE} height={ICON_SIZE}>
          <Path d={cutoutPath(badgeWidth)} fill='#000' fillRule='evenodd' />
        </Svg>
      }
    >
      {children}
    </MaskedView>
  );
}

/**
 * The icon's box with a rounded hole where the badge sits, in the icon's own
 * coordinates. The badge hangs past the box's top-right corner, so the hole
 * does too; only the part over the icon matters.
 */
function cutoutPath(badgeWidth: number): string {
  const right = ICON_SIZE - BADGE_OFFSET_RIGHT + CUTOUT_GAP;
  const left = right - badgeWidth - CUTOUT_GAP * 2;
  const top = BADGE_OFFSET_TOP - CUTOUT_GAP;
  const bottom = BADGE_OFFSET_TOP + BADGE_HEIGHT + CUTOUT_GAP;
  const r = Math.min(CUTOUT_RADIUS, (right - left) / 2, (bottom - top) / 2);

  const box = `M0 0H${ICON_SIZE}V${ICON_SIZE}H0Z`;
  const hole =
    `M${left + r} ${top}H${right - r}A${r} ${r} 0 0 1 ${right} ${top + r}` +
    `V${bottom - r}A${r} ${r} 0 0 1 ${right - r} ${bottom}` +
    `H${left + r}A${r} ${r} 0 0 1 ${left} ${bottom - r}` +
    `V${top + r}A${r} ${r} 0 0 1 ${left + r} ${top}Z`;
  return box + hole;
}
