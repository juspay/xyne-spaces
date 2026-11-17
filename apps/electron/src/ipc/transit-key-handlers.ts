import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import log from 'electron-log/main';
import { isFirstPartyUrl } from '../services/request-interceptor';
import { deriveTransitSharedSecret, getTransitPublicKey, isP256Point } from '../transit-key';

// Any app window's top-level first-party page — the main window, the call window, pop-outs —
// gets the same key: each registers its public key on the shared session, so a window with a
// different key would overwrite the others'. Webviews and sub-frames are refused.
function isAppPageSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  const trusted =
    !!frame &&
    frame.parent === null &&
    !!BrowserWindow.fromWebContents(event.sender) &&
    isFirstPartyUrl(frame.url);
  if (!trusted) {
    log.warn('[TransitKey] Blocked IPC from untrusted sender');
  }
  return trusted;
}

export function setupTransitKeyIpcHandlers(): void {
  ipcMain.handle('transit-key:get-public-key', async (event) => {
    if (!isAppPageSender(event)) throw new Error('Untrusted sender');
    return getTransitPublicKey();
  });

  ipcMain.handle('transit-key:derive', async (event, serverPoint: unknown) => {
    if (!isAppPageSender(event)) throw new Error('Untrusted sender');
    if (!isP256Point(serverPoint)) {
      throw new Error('serverPoint must be a 65-byte uncompressed P-256 point');
    }
    return deriveTransitSharedSecret(serverPoint);
  });
}
