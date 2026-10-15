import type { TicketDetailTabId } from './types';

export const TICKET_DETAIL_TABS: ReadonlyArray<{ id: TicketDetailTabId; label: string }> = [
  { id: 'email', label: 'Email' },
  { id: 'messages', label: 'Messages' },
  { id: 'details', label: 'Details' },
] as const;

/** Tab bar height under sticky header. */
export const TICKET_DETAIL_TABS_HEIGHT = 48;

/** Match tickets-list card radii / gap. */
export const EMAIL_CHAIN_OUTER_RADIUS = 12;
export const EMAIL_CHAIN_INNER_RADIUS = 3;
export const EMAIL_CHAIN_ROW_GAP = 2;
export const EMAIL_AVATAR_SIZE = 40;
export const EMAIL_PREVIEW_MAX_CHARS = 160;
export const EMAIL_DETAILS_CHEVRON_MS = 180;
export const EMAIL_CHAIN_H_INSET = 8;

export const TICKET_STAR_FILLED = '#EAB308';
