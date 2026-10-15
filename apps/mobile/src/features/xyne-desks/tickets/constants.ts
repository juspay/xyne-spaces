import { TicketPriority } from '@xyne/shared';

import type { TicketMailboxFolderItem } from './types';

export const TICKETS_PAGE_SIZE = 50;
/** Hard cap on the growing window (PAGE_SIZE * MAX_PAGES rows). */
export const TICKETS_MAX_PAGES = 10;

/** Dashboard-aligned priority filter options (supportTicketsPageV3). */
export const TICKET_PRIORITY_FILTER_OPTIONS = [
  { value: TicketPriority.LOW, label: 'Low' },
  { value: TicketPriority.MEDIUM, label: 'Medium' },
  { value: TicketPriority.HIGH, label: 'High' },
  { value: TicketPriority.CRITICAL, label: 'Critical' },
] as const;

/** Gmail-like 3-line row for LegendList recycling. */
export const TICKET_LIST_AVATAR_SIZE = 40;
/** Visible card height (avatar + 3 text lines). */
export const TICKET_LIST_CARD_HEIGHT = 88;
/** Inner corners in a grouped block (middle rows + inner ends). */
export const TICKET_LIST_CORNER_RADIUS_DEFAULT = 3;
/** Outer corners on first/last rows of the group. */
export const TICKET_LIST_CARD_RADIUS = 12;
/** Gap between consecutive rows — baked into getFixedItemSize for LegendList. */
export const TICKET_LIST_ROW_GAP = 2;
export const TICKET_LIST_ROW_HEIGHT = TICKET_LIST_CARD_HEIGHT + TICKET_LIST_ROW_GAP;
export const TICKET_LIST_ESTIMATED_ITEM_SIZE = TICKET_LIST_ROW_HEIGHT;
export const TICKETS_LIST_DRAW_DISTANCE = 360;

export const TICKET_LIST_H_INSET = 8;

export const TICKETS_SEARCH_MORPH_MS = 280;
export const TICKETS_FILTER_OVERLAY_MS = 280;
export const TICKETS_SELECTION_FADE_MS = 180;
/** Default / search caps for assignee filter user picker (mirrors dashboard UserSubmenu). */
export const TICKETS_ASSIGNEE_FILTER_DEFAULT_LIMIT = 20;
export const TICKETS_ASSIGNEE_FILTER_SEARCH_LIMIT = 40;
/** Caps for stages / AI category / user groups multi-select overlays. */
export const TICKETS_MULTI_SELECT_FILTER_DEFAULT_LIMIT = 50;
export const TICKETS_MULTI_SELECT_FILTER_SEARCH_LIMIT = 50;
export const TICKETS_DRAWER_WIDTH_RATIO = 0.82;
export const TICKETS_DRAWER_MAX_WIDTH = 320;
/** Shared spring for open / close / pan snap — UI-thread, no bounce past edges. */
export const TICKETS_DRAWER_SPRING = {
  damping: 28,
  stiffness: 340,
  mass: 0.78,
  overshootClamping: true,
} as const;
/** Progress / velocity thresholds for pan dismiss. */
export const TICKETS_DRAWER_CLOSE_PROGRESS = 0.55;
export const TICKETS_DRAWER_CLOSE_VELOCITY = -650;

export const TICKET_AVATAR_COLORS = [
  '#7E57C2',
  '#5C6BC0',
  '#26A69A',
  '#EF5350',
  '#8D6E63',
  '#42A5F5',
  '#EC407A',
  '#66BB6A',
] as const;

export const TICKET_MAILBOX_FOLDERS: TicketMailboxFolderItem[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'all', label: 'All Mail' },
  { id: 'starred', label: 'Starred' },
  { id: 'spam', label: 'Spam' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'sent', label: 'Sent' },
];
