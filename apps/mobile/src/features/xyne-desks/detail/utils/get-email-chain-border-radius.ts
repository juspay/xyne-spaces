import { EMAIL_CHAIN_INNER_RADIUS, EMAIL_CHAIN_OUTER_RADIUS } from '../constants';
import type { EmailChainItemPosition } from '../types';

/** Same position rules as tickets-list rows. */
export function getEmailChainItemPosition(index: number, total: number): EmailChainItemPosition {
  if (total <= 1) return 'single';
  if (index === 0) return 'first';
  if (index === total - 1) return 'last';
  return 'middle';
}

/** Tickets-list style radii: outer 12 on ends, inner 3 between rows. */
export function getEmailChainBorderRadius(position: EmailChainItemPosition): {
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
  borderBottomLeftRadius: number;
  borderBottomRightRadius: number;
} {
  const outer = EMAIL_CHAIN_OUTER_RADIUS;
  const inner = EMAIL_CHAIN_INNER_RADIUS;

  switch (position) {
    case 'single':
      return {
        borderTopLeftRadius: outer,
        borderTopRightRadius: outer,
        borderBottomLeftRadius: outer,
        borderBottomRightRadius: outer,
      };
    case 'first':
      return {
        borderTopLeftRadius: outer,
        borderTopRightRadius: outer,
        borderBottomLeftRadius: inner,
        borderBottomRightRadius: inner,
      };
    case 'middle':
      return {
        borderTopLeftRadius: inner,
        borderTopRightRadius: inner,
        borderBottomLeftRadius: inner,
        borderBottomRightRadius: inner,
      };
    case 'last':
      return {
        borderTopLeftRadius: inner,
        borderTopRightRadius: inner,
        borderBottomLeftRadius: outer,
        borderBottomRightRadius: outer,
      };
  }
}
