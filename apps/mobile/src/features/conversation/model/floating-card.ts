import { FLOATING_CARD_NAV_BAR_GAP } from '../constants';

/**
 * How far a floating card (the thread card, the "+" tray) ends above the
 * screen bottom: its Figma gap, floating over the iOS home indicator, but
 * clear of an Android navigation bar, which takes taps.
 */
export function floatingCardBottom(
  gap: number,
  safeAreaBottom: number,
  navigationBarTakesTaps: boolean,
): number {
  if (!navigationBarTakesTaps) return gap;
  return Math.max(gap, safeAreaBottom + FLOATING_CARD_NAV_BAR_GAP);
}
