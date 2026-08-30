import { v5 as uuidv5 } from 'uuid';
import { BaseTicketType, BoardType } from "../zero/types.js";

export const ClassifiableTicketTypes = Object.values(BaseTicketType).filter(
    (type) => type !== BaseTicketType.Release
)

export type ClassifiableTicketType = typeof ClassifiableTicketTypes[number];

export const isReleaseTicket = (ticketType?: BaseTicketType | null): boolean => {
    if (!ticketType) return false;

    return ticketType === BaseTicketType.Release || ticketType === BaseTicketType.Hotfix;
}

export const stringFromFormValue = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Whether sub-ticket links on a board are the user's to make by hand (FLOW/RELEASE are not).
 * An allow-list on purpose: `undefined` while boardData loads must fail closed.
 */
export const isManualSubTicketBoard = (boardType?: BoardType | null): boolean =>
  boardType === BoardType.DEFAULT || boardType === BoardType.NON_LINEAR;

const LINKED_SUB_TICKET_NAMESPACE = 'edffd0e4-129b-4f8a-9f73-c1a077f74433';

/**
 * Id of the `sub_tickets` row for "mappedTicketId is a sub-ticket of ticketId". Derived so
 * racers converge on one row; the mapping id stays random so the unique index rejects one.
 */
export const linkedSubTicketId = (ticketId: string, mappedTicketId: string): string =>
  uuidv5(`linked-subticket:${ticketId}:${mappedTicketId}`, LINKED_SUB_TICKET_NAMESPACE);

// Runaway backstop for linkExisting's ancestor walk, not a product limit: one query per
// node, so ~1s of lock hold even at 5ms/query - well inside its 5s lock_timeout.
export const MAX_SUB_TICKET_ANCESTOR_WALK = 200;
