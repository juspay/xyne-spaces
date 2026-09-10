import { createContext } from 'react';

export type EntityLinkScope = {
  sourceType: 'CANVAS' | 'TRACK' | 'FOLDER';
  sourceId: string;
  /**
   * File the conversation on this track as well as on the owner. Set for folder
   * scopes, so a track's conversation list covers everything discussed inside it.
   */
  rollUpTrackId?: string;
};

export const EntityLinkContext = createContext<EntityLinkScope | null>(null);
