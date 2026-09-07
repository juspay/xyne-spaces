import { createContext } from 'react';

export type EntityLinkScope = {
  sourceType: 'CANVAS' | 'TRACK';
  sourceId: string;
};

export const EntityLinkContext = createContext<EntityLinkScope | null>(null);
