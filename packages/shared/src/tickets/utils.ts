import { BaseTicketType } from "../zero/types.js";

export const ClassifiableTicketTypes = Object.values(BaseTicketType).filter(
    (type) =>
        type !== BaseTicketType.Release &&
        type !== BaseTicketType.Support &&
        type !== BaseTicketType.DESK
)

export type ClassifiableTicketType = typeof ClassifiableTicketTypes[number];

export const isReleaseTicket = (ticketType?: BaseTicketType | null): boolean => {
    if (!ticketType) return false;

    return ticketType === BaseTicketType.Release || ticketType === BaseTicketType.Hotfix;
}

export const stringFromFormValue = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;