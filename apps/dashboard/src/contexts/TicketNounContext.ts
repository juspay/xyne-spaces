import { createContext, useContext, useMemo } from 'react';

/** What a screen calls its tickets, in lower case: SDLC hubs call them issues. */
export interface TicketNoun {
  singular: string;
  plural: string;
}

export interface TicketNounWords extends TicketNoun {
  singularTitle: string;
  pluralTitle: string;
}

export const DEFAULT_TICKET_NOUN: TicketNoun = { singular: 'ticket', plural: 'tickets' };

export const TicketNounContext = createContext<TicketNoun>(DEFAULT_TICKET_NOUN);

const toTitle = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export const useTicketNoun = (): TicketNounWords => {
  const noun = useContext(TicketNounContext);
  return useMemo(
    () => ({ ...noun, singularTitle: toTitle(noun.singular), pluralTitle: toTitle(noun.plural) }),
    [noun],
  );
};
