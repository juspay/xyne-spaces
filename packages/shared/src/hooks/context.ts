import { createContext, useContext } from 'react';

export interface SharedAuthContext {
  userID: string;
}

const AuthContext = createContext<SharedAuthContext | null>(null);

export const SharedAuthProvider = AuthContext.Provider;

export const useSharedAuthContext = (): SharedAuthContext => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useSharedAuthContext must be used within a SharedAuthProvider');
  }
  return ctx;
};
