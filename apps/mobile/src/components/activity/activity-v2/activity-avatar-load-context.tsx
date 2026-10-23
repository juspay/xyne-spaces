import { createContext, useContext } from 'react';

const ActivityRemoteAvatarLoadContext = createContext(false);

export const ActivityRemoteAvatarLoadProvider = ActivityRemoteAvatarLoadContext.Provider;

export const useActivityRemoteAvatarLoad = (): boolean =>
  useContext(ActivityRemoteAvatarLoadContext);
