import { TicketStatusV2 } from '@xyne/shared';

export type TicketStatusStyle = {
  label: string;
  /** CSS variable for the pill text / icon. */
  colorVar: string;
  /** CSS variable for the pill background. */
  softBgVar: string;
};

const STATUS_STYLES: Record<TicketStatusV2, TicketStatusStyle> = {
  [TicketStatusV2.TODO]: {
    label: 'Todo',
    colorVar: '--color-ticket-status-todo',
    softBgVar: '--color-ticket-status-todo-soft',
  },
  [TicketStatusV2.STARTED]: {
    label: 'Started',
    colorVar: '--color-ticket-status-started',
    softBgVar: '--color-ticket-status-started-soft',
  },
  [TicketStatusV2.PAUSED]: {
    label: 'Paused',
    colorVar: '--color-ticket-status-paused',
    softBgVar: '--color-ticket-status-paused-soft',
  },
  [TicketStatusV2.CANCELLED]: {
    label: 'Cancelled',
    colorVar: '--color-ticket-status-cancelled',
    softBgVar: '--color-ticket-status-cancelled-soft',
  },
  [TicketStatusV2.COMPLETED]: {
    label: 'Completed',
    colorVar: '--color-ticket-status-completed',
    softBgVar: '--color-ticket-status-completed-soft',
  },
};

const FALLBACK_STYLE: TicketStatusStyle = {
  label: '—',
  colorVar: '--color-secondary-foreground',
  softBgVar: '--color-ticket-table-header-bg',
};

/** Dashboard `StatusOptions` colours + labels; unknown / null → neutral fallback. */
export function getTicketStatusStyle(
  status: TicketStatusV2 | string | null | undefined,
): TicketStatusStyle {
  if (!status) return FALLBACK_STYLE;
  const known = STATUS_STYLES[status as TicketStatusV2];
  if (known) return known;
  // Unknown enum value from a newer server: humanise it rather than hide it.
  const label = status
    .split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
  return { ...FALLBACK_STYLE, label };
}
