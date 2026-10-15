import { TicketStatusV2, type Ticket } from '@xyne/shared';

/** Sub-tickets open, and load, this many at a time. */
export const SUB_TICKETS_PAGE_SIZE = 3;

export const isSubTicketDone = (ticket: Ticket | null | undefined): boolean =>
  ticket?.statusV2 === TicketStatusV2.COMPLETED;

export const subTicketsFooterLabel = (shown: number, total: number, isLoading: boolean): string =>
  isLoading ? 'Loading' : `Show ${Math.min(SUB_TICKETS_PAGE_SIZE, total - shown)} more`;
