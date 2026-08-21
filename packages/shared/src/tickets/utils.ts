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
 * Whether sub-ticket links on a board are the user's to make and break by hand.
 * FLOW and RELEASE boards build their mappings automatically and key idempotency off
 * them, so hand-editing corrupts a run.
 *
 * An ALLOW-list on purpose: callers ask this while boardData is still loading, and a
 * deny-list would answer true for `undefined`. Unknown board types fail closed.
 */
export const isManualSubTicketBoard = (boardType?: BoardType | null): boolean =>
  boardType === BoardType.DEFAULT || boardType === BoardType.NON_LINEAR;

const LINKED_SUB_TICKET_NAMESPACE = 'edffd0e4-129b-4f8a-9f73-c1a077f74433';

/**
 * Id of the `sub_tickets` row for "mappedTicketId is a sub-ticket of ticketId".
 *
 * Derived from the pair so two racing links converge on ONE row: Zero compiles inserts
 * to `ON CONFLICT (pk) DO NOTHING`, making the loser's insert a harmless no-op.
 *
 * The mapping id is deliberately NOT derived — that would make the loser's mapping
 * insert silently succeed too, and it would go on to write a duplicate activity and
 * notification. A random one instead violates the (ticketId, subTicketId) unique index
 * and rolls the whole transaction back.
 */
export const linkedSubTicketId = (ticketId: string, mappedTicketId: string): string =>
  uuidv5(`linked-subticket:${ticketId}:${mappedTicketId}`, LINKED_SUB_TICKET_NAMESPACE);
