export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined;
};

export const setupElectronAuthListeners = (
  onSuccess: () => void,
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
