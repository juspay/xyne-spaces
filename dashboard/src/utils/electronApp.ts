import type { ElectronAPI } from '../types/electron';
import type { NavigateFunction } from 'react-router-dom';

interface ElectronWindow extends Window {
  electronAPI?: ElectronAPI;
  electron?: unknown;
}

/**
 * Utility function to detect if the application is running inside an Electron app
 * @returns {boolean} true if running in Electron, false otherwise
 */
export const isElectronApp = (): boolean => {
  // Check if we're in a browser environment first
  if (typeof window === 'undefined') {
    return false;
  }

  // Method 1: Check for electron-specific APIs in window object
  const electronWindow = window as ElectronWindow;
  if (electronWindow.electronAPI || electronWindow.electron) {
    return true;
  }

  // Method 2: Check user agent for Electron
  if (navigator.userAgent && navigator.userAgent.toLowerCase().includes('electron')) {
    return true;
  }

  // Method 3: Check if process.versions.electron exists (if node integration is enabled)
  try {
    if (typeof process !== 'undefined' && process.versions && process.versions['electron']) {
      return true;
    }
  } catch {
    // process might not be available in renderer process
  }

  return false;
};

export const isStandaloneWindow = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.location.pathname.startsWith('/newWindow/');
};

export const isElectronStandaloneWindow = (): boolean => {
  return isElectronApp() && isStandaloneWindow();
};

const STANDALONE_SUPPORTED_ROUTES = ['/chat/'];

export const isStandaloneSupportedPath = (path: string): boolean => {
  return STANDALONE_SUPPORTED_ROUTES.some(route => path.startsWith(route));
};

export const toStandalonePath = (path: string): string => {
  if (path.startsWith('/newWindow/')) {
    return path;
  }
  try {
    const url = new URL(path, window.location.origin);
    return `/newWindow${url.pathname}${url.search}${url.hash}`;
  } catch {
    return `/newWindow${path}`;
  }
};

export const toRegularPath = (path: string): string => {
  if (path.startsWith('/newWindow/')) {
    return path.replace('/newWindow', '');
  }
  return path;
};

export const getNavigationPath = (path: string): string => {
  const normalizedPath = toRegularPath(path);

  if (isStandaloneWindow()) {
    return toStandalonePath(normalizedPath);
  }
  return normalizedPath;
};

export interface StandaloneNavigateOptions {
  event?: React.MouseEvent | MouseEvent | undefined;

  state?: unknown;

  replace?: boolean;
}

export const standaloneNavigate = (
  navigate: NavigateFunction,
  path: string,
  options?: StandaloneNavigateOptions,
): void => {
  const { event, ...navigateOptions } = options || {};
  const normalizedPath = toRegularPath(path);
  const isCmdOrCtrlClick = event && (event.metaKey || event.ctrlKey);

  if (isElectronApp() && isCmdOrCtrlClick && isStandaloneSupportedPath(normalizedPath)) {
    const newWindowPath = toStandalonePath(normalizedPath);
    const newWindow = window.open(newWindowPath, '_blank');
    if (newWindow) {
      newWindow.focus();
    } else {
      console.warn('Failed to open new window,PopUp may be blocked');
    }
    return;
  }

  if (isStandaloneWindow()) {
    void navigate(toStandalonePath(normalizedPath), navigateOptions);
    return;
  }

  void navigate(normalizedPath, navigateOptions);
};
