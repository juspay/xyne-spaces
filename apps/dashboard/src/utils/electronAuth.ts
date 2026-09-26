export interface ElectronAuthData {
  workspaces: { id: string; name: string; role: string }[];
  email: string;
  name: string;
  picture?: string;
  userExistsButRemoved: boolean;
  domainConflictError?: string;
  publicEmailDomainError?: string;
  enterpriseJoinOrgName?: string;
  enterpriseJoinWorkspaces?: string;
}

export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined;
};

/** Sent by the Electron main-process 401 interceptor alongside `auth:token-expired`. */
export interface TokenExpiredPayload {
  /** The backend URL whose 401 response triggered the session teardown. */
  url?: string;
  resourceType?: string;
}

export const setupElectronAuthListeners = (
  onSuccess: (data?: ElectronAuthData) => void,
  onTokenExpired: (payload?: TokenExpiredPayload) => void,
): (() => void) => {
  if (!isElectron() || !window.electronAPI) {
    return () => {};
  }

  if (typeof window.electronAPI.onAuthSuccess === 'function') {
    window.electronAPI.onAuthSuccess(onSuccess);
  }
  if (typeof window.electronAPI.onTokenExpired === 'function') {
    window.electronAPI.onTokenExpired(onTokenExpired);
  }

  return () => {
    // Cleanup if needed
  };
};
