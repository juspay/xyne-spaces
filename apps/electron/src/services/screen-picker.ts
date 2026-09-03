import { BrowserWindow, desktopCapturer, ipcMain } from 'electron';
import Logger from 'electron-log/main';
import { getMainWindow } from '../window/manager';

export type ScreenSource = {
  id: string;
  name: string;
  thumbnail: string; // base64 data URL (320×180)
  displayId: string;
  type: 'screen' | 'window';
};

export type ScreenPickerPayload =
  | { sources: ScreenSource[]; permissionError: null }
  | { sources: []; permissionError: 'denied' };

const openPickers = new Set<number>();

/**
 * Cancels the pending getDisplayMedia() request and shows the permission-denied
 * state in the custom picker UI. Never falls back to the native OS picker.
 */
function showPermissionError(
  callback: (streams: Electron.Streams) => void,
  requester: BrowserWindow,
): void {
  Logger.info('[ScreenPicker] No sources — Screen Recording permission likely denied');
  // Cancel the pending request — Electron may throw when no video stream is provided
  try { callback({} as Electron.Streams); } catch { /* suppress */ }

  if (!requester.isDestroyed()) {
    requester.webContents.send('screen-picker:show', {
      sources: [],
      permissionError: 'denied',
    } satisfies ScreenPickerPayload);
  }
}

/**
 * Shows the custom in-app screen picker.
 *
 * Calls desktopCapturer.getSources() — this triggers the macOS "Screen Recording"
 * permission prompt on first run. If permission is denied (no sources returned),
 * shows the permission error UI.
 */
export function showScreenPicker(
  callback: (streams: Electron.Streams) => void,
  requestingWindow?: BrowserWindow | null,
): void {
  const requester = requestingWindow ?? getMainWindow();
  if (!requester || requester.isDestroyed()) {
    Logger.warn('[ScreenPicker] Requesting window not available');
    try { callback({} as Electron.Streams); } catch { /* suppress */ }
    return;
  }

  const requesterId = requester.webContents.id;

  if (openPickers.has(requesterId)) {
    requester.focus();
    return;
  }

  openPickers.add(requesterId);
  let callbackCalled = false;

  const isFromRequester = (event: Electron.IpcMainEvent): boolean =>
    event.sender.id === requesterId;

  const removeListeners = (): void => {
    openPickers.delete(requesterId);
    ipcMain.removeListener('screen-picker:select', handleSelect);
    ipcMain.removeListener('screen-picker:cancel', handleCancel);
  };

  const cleanup = (): void => {
    removeListeners();
    if (!requester.isDestroyed()) {
      requester.webContents.send('screen-picker:close');
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const handleSelect = async (
    event: Electron.IpcMainEvent,
    sourceId: string,
    shareAudio: boolean,
  ): Promise<void> => {
    if (!isFromRequester(event)) return;
    if (callbackCalled) return;
    callbackCalled = true;
    cleanup();
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const selected = sources.find(s => s.id === sourceId);
      if (selected) {
        const streams: Electron.Streams = { video: selected };
        if (shareAudio) {
          // 'loopback' captures system audio on Windows; on macOS this is a no-op
          (streams as Record<string, unknown>)['audio'] = 'loopback';
        }
        try { callback(streams); } catch (err) {
          Logger.error('[ScreenPicker] Callback error on select:', err);
        }
      } else {
        try { callback({} as Electron.Streams); } catch { /* suppress */ }
      }
    } catch (err) {
      Logger.error('[ScreenPicker] getSources error on select:', err);
      try { callback({} as Electron.Streams); } catch { /* suppress */ }
    }
  };

  const handleCancel = (event: Electron.IpcMainEvent): void => {
    if (!isFromRequester(event)) return;
    if (callbackCalled) return;
    callbackCalled = true;
    cleanup();
    try { callback({} as Electron.Streams); } catch { /* suppress "no video stream" error */ }
  };

  const handleRequesterClosed = (): void => {
    if (callbackCalled) return;
    callbackCalled = true;
    removeListeners();
    try { callback({} as Electron.Streams); } catch { /* suppress */ }
  };
  requester.once('closed', handleRequesterClosed);

  ipcMain.on('screen-picker:select', handleSelect);
  ipcMain.on('screen-picker:cancel', handleCancel);

  // Fetch sources — triggers macOS permission prompt on first run
  void (async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1280, height: 720 },
      });

      Logger.info(`[ScreenPicker] Got ${sources.length} sources`);

      if (sources.length === 0) {
        callbackCalled = true;
        removeListeners();
        showPermissionError(callback, requester);
        return;
      }

      // Exclude the app's own window and any sources with blank thumbnails
      // (blank = macOS system overlay windows that return their app icon instead
      // of a real screenshot, e.g. "App Icon Window", "Gesture Blocking Overlay")
      const serialized: ScreenSource[] = sources
        .map(s => ({
          id: s.id,
          name: s.name,
          thumbnail: s.thumbnail.toDataURL(),
          displayId: s.display_id,
          type: s.id.startsWith('screen:') ? 'screen' : 'window',
        }));

      if (requester.isDestroyed()) return;
      requester.webContents.send('screen-picker:show', {
        sources: serialized,
        permissionError: null,
      } satisfies ScreenPickerPayload);
    } catch (err) {
      Logger.error('[ScreenPicker] getSources threw:', err);
      callbackCalled = true;
      removeListeners();
      showPermissionError(callback, requester);
    }
  })();
}
