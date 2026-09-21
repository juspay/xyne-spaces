import { createContext } from 'react';

/** The five things an SDLC conversation can hang off; the backend's
 *  entityLinkContextSchema accepts exactly these. Declared once so the ticket
 *  and electron paths cannot drift from the panel that produces them. */
export type EntityLinkSourceType = 'CANVAS' | 'TRACK' | 'FOLDER' | 'LINK' | 'ATTACHMENT';

export type EntityLinkScope = {
  sourceType: EntityLinkSourceType;
  sourceId: string;
  rollUpTrackId?: string;
};

export const EntityLinkContext = createContext<EntityLinkScope | null>(null);
