import type { ReactElement } from 'react';
import { useElectronBadge } from '../../hooks/useElectronBadge';

/**
 * Side-effect-only component (renders nothing) that keeps the native desktop
 * app-icon badge in sync with the total unread message count via
 * {@link useElectronBadge}.
 *
 * Mounted once at the app root (next to the other global IPC/side-effect
 * handlers such as NotificationHandler). It is a no-op outside the Electron
 * desktop app.
 */
export const ElectronBadgeSync = (): ReactElement | null => {
  useElectronBadge();
  return null;
};
