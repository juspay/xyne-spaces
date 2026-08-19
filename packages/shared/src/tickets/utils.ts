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
 *
 * FLOW boards materialise their sub-tickets from a flow run
 * (services/subTicketService.ts), and RELEASE boards from commit analysis
 * (database/repositories/applicationRepository.ts) — that code keys idempotency off
 * the very mappings a hand-edit would add or remove, and `application_release_tickets`
 * / `release_events` reference `sub_tickets.id` with no FK to protect them. So the
 * "Add existing sub-ticket" picker and the unlink control stay off both.
 *
 * Deliberately an ALLOW-list, so an unknown board type answers false. The dashboard
 * asks this while `boardData` is still loading, and a deny-list would answer true for
 * `undefined` — rendering Unlink on a FLOW or RELEASE board for as long as that query
 * took, where the optimistic twin would really delete the rows before the server
 * refused. A board type added later fails closed for the same reason.
 */
export const isManualSubTicketBoard = (boardType?: BoardType | null): boolean =>
  boardType === BoardType.DEFAULT || boardType === BoardType.NON_LINEAR;

const LINKED_SUB_TICKET_NAMESPACE = 'edffd0e4-129b-4f8a-9f73-c1a077f74433';

/**
 * Id of the `sub_tickets` row representing "ticket `mappedTicketId` is a sub-ticket".
 *
 * Derived from the pair rather than minted per click so two racing pushes for the same
 * link write the SAME row. Zero compiles `tx.mutate.<table>.insert` to
 * `INSERT ... ON CONFLICT (<pk>) DO NOTHING`, so the loser's insert is a harmless
 * no-op that converges on the winner's row instead of creating a second row for the
 * same child — which is what would make the `.one()`/`findFirst` lookups on
 * mappedTicketId ambiguous.
 *
 * The MAPPING id is deliberately NOT derived. Because inserts are ON CONFLICT DO
 * NOTHING on the primary key, deriving it too would make the loser's mapping insert
 * silently succeed as well, and it would sail on to write a duplicate activity, a
 * duplicate system message and a duplicate notification. A random mapping id means
 * the loser instead violates the `ticket_sub_ticket_mappings(ticketId, subTicketId)`
 * unique index, which rolls its whole transaction back — the behaviour that index was
 * added for.
 *
 * Deriving is still deterministic in the sense the mutator guidelines care about: the
 * optimistic client twin and the server compute the same value from the same args.
 */
export const linkedSubTicketId = (ticketId: string, mappedTicketId: string): string =>
  uuidv5(`linked-subticket:${ticketId}:${mappedTicketId}`, LINKED_SUB_TICKET_NAMESPACE);
