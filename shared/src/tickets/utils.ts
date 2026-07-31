import { BaseTicketType } from "./types";

export const ClassifiableTicketTypes = Object.values(BaseTicketType).filter(
    (type) => type !== BaseTicketType.Release
)

export type ClassifiableTicketType = typeof ClassifiableTicketTypes[number];

export const isReleaseTicket = (ticketType?: BaseTicketType | null): boolean => {
    if (!ticketType) return false;

    return ticketType === BaseTicketType.Release || ticketType === BaseTicketType.Hotfix;
}