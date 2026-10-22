import { ipcMain } from 'electron';
import log from 'electron-log/main';
import { isMainWindowSender } from './handlers';
import { getSpacesMcpStatus, signInSpacesMcp, signOutSpacesMcp } from '../services/spaces-mcp';

/**
 * Spaces MCP sign-in, sign-out and status, for the Developers tab.
 *
 * They act on the user's account and its credential on disk, so only the
 * main window's top-level page may call them. Anywhere else they answer
 * `unavailable`, and the page shows the terminal instructions instead.
 */
export function setupSpacesMcpIpcHandlers(): void {
  // Logged without the session: the outcome and, on failure, why.
  ipcMain.handle('spaces-mcp:status', async (event) => {
    if (!isMainWindowSender(event)) return { state: 'unavailable' };
    const status = await getSpacesMcpStatus();
    log.info('[spaces-mcp] status', {
      state: status.state,
      ...(status.state === 'unreachable' ? { message: status.message } : {}),
    });
    return status;
  });

  ipcMain.handle('spaces-mcp:sign-in', async (event) => {
    if (!isMainWindowSender(event)) {
      return { ok: false, message: 'Sign in from the main Xyne Spaces window.' };
    }
    const result = await signInSpacesMcp();
    log.info('[spaces-mcp] sign-in', result.ok ? { ok: true, state: result.status.state } : result);
    return result;
  });

  ipcMain.handle('spaces-mcp:sign-out', async (event) => {
    if (!isMainWindowSender(event)) {
      return { ok: false, message: 'Sign out from the main Xyne Spaces window.' };
    }
    const result = await signOutSpacesMcp();
    log.info('[spaces-mcp] sign-out', result.ok ? { ok: true, notice: result.notice } : result);
    return result;
  });
}
