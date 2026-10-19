import type { TicketListItemPosition } from '../types';
import { TICKET_LIST_CARD_RADIUS, TICKET_LIST_CORNER_RADIUS_DEFAULT } from '../constants';

export function getTicketListItemPosition(index: number, total: number): TicketListItemPosition {
  if (total <= 1) return 'single';
  if (index === 0) return 'first';
  if (index === total - 1) return 'last';
  return 'middle';
}

export function getTicketListItemBorderRadius(position: TicketListItemPosition): {
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
  borderBottomLeftRadius: number;
  borderBottomRightRadius: number;
} {
  const outer = TICKET_LIST_CARD_RADIUS;
  const inner = TICKET_LIST_CORNER_RADIUS_DEFAULT;

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
