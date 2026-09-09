import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import log from 'electron-log/main';

export type ConsentDuration = 'none' | '5min' | '1hour' | 'session';

export interface AgentConsentPayload {
  agentName: string;
  agentType: string;
  description: string;
  requestedBy: string;
  signed: boolean | null;
  isKnown: boolean;
  capabilities: string[];
}

export interface AgentConsentResult {
  approved: boolean;
  duration: ConsentDuration;
}

const DEFAULT_WIDTH = 440;
const INITIAL_HEIGHT = 560;

/**
 * Show the custom agent-authorization consent modal and resolve with the user's choice.
 *
 * A framed, parented modal (HTML/CSS) replaces the cramped native message box: it renders the
 * resolved requesting process, its signing status, a capability list, and a duration selector.
 * All agent-supplied text is passed over IPC and rendered via textContent in the renderer, so it
 * cannot inject markup. Falls back to a Deny result if no parent window is available.
 */
export function showAgentConsentWindow(
  parent: BrowserWindow | null,
  payload: AgentConsentPayload,
): Promise<AgentConsentResult> {
  return new Promise((resolve) => {
    if (!parent || parent.isDestroyed()) {
      log.error('[AgentConsent] No parent window available for consent modal');
      resolve({ approved: false, duration: 'none' });
      return;
    }

    const win = new BrowserWindow({
      width: DEFAULT_WIDTH,
      height: INITIAL_HEIGHT,
      parent,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      transparent: true,
      show: false,
      title: 'Agent Authorization',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'preload.js'),
      },
    });

    let settled = false;
    const wcId = win.webContents.id;

    const cleanup = () => {
      ipcMain.removeListener('agent-consent:respond', onRespond);
      ipcMain.removeListener('agent-consent:content-height', onSize);
    };

    const finish = (result: AgentConsentResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!win.isDestroyed()) win.close();
      resolve(result);
    };

    const onRespond = (event: Electron.IpcMainEvent, result: AgentConsentResult) => {
      if (event.sender.id !== wcId) return; // ignore other windows
      const duration: ConsentDuration =
        result?.duration === '1hour' || result?.duration === 'session' || result?.duration === '5min'
          ? result.duration
          : '5min';
      finish({ approved: !!result?.approved, duration: result?.approved ? duration : 'none' });
    };

    const onSize = (event: Electron.IpcMainEvent, width: number, height: number) => {
      if (event.sender.id !== wcId || win.isDestroyed()) return;
      const w = width ? Math.ceil(width) : DEFAULT_WIDTH;
      const h = height ? Math.ceil(height) + 4 : INITIAL_HEIGHT;
      win.setContentSize(w, h);
      win.center();
      if (!win.isVisible()) win.show();
    };

    ipcMain.on('agent-consent:respond', onRespond);
    ipcMain.on('agent-consent:content-height', onSize);

    win.webContents.once('did-finish-load', () => {
      win.webContents.send('agent-consent:show', payload);
      // Fallback reveal in case the size IPC is delayed.
      setTimeout(() => {
        if (!settled && !win.isDestroyed() && !win.isVisible()) win.show();
      }, 400);
    });

    // Closing the window (e.g. via OS) without an explicit choice counts as Deny.
    win.on('closed', () => finish({ approved: false, duration: 'none' }));

    const consentHtml = path.join(__dirname, '..', '..', 'assets', 'agent-consent.html');
    void win.loadFile(consentHtml).catch((err) => {
      log.error('[AgentConsent] Failed to load consent modal:', err);
      finish({ approved: false, duration: 'none' });
    });
  });
}
