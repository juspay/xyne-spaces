import { createContext } from 'react';

export type EntityLinkScope = {
  sourceType: 'CANVAS' | 'TRACK' | 'FOLDER';
  sourceId: string;
  rollUpTrackId?: string;
};

export const EntityLinkContext = createContext<EntityLinkScope | null>(null);
