import { BaseTicketType } from "./types";

export const isReleaseTicket = (ticketType?: BaseTicketType | null): boolean => {
    if (!ticketType) return false;

    return ticketType === BaseTicketType.Release || ticketType === BaseTicketType.Hotfix;
}