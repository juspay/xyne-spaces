export interface ElectronAuthData {
  workspaces: { id: string; name: string; role: string }[];
  email: string;
  name: string;
  picture?: string;
  userExistsButRemoved: boolean;
}

export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined;
};

export const setupElectronAuthListeners = (
  onSuccess: (data?: ElectronAuthData) => void,
  onTokenExpired: () => void,
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
