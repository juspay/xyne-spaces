import { ipcMain } from 'electron';
import log from 'electron-log/main';
import { browserTabsService } from '../services/browser-tabs';

export function setupBrowserTabsHandlers(): void {
  log.info('[BrowserTabs] Setting up IPC handlers');

  // Create a new tab
  ipcMain.handle('browser-tabs:create', async (_event, url: string) => {
    try {
      const tab = browserTabsService.createTab(url);
      return { success: true, tab };
    } catch (error) {
      log.error('[BrowserTabs] Error creating tab:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Close a tab
  ipcMain.handle('browser-tabs:close', async (_event, tabId: string) => {
    try {
      const success = browserTabsService.closeTab(tabId);
      return { success };
    } catch (error) {
      log.error('[BrowserTabs] Error closing tab:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Switch to a tab
  ipcMain.handle('browser-tabs:switch', async (_event, tabId: string) => {
    try {
      const success = browserTabsService.switchTab(tabId);
      return { success };
    } catch (error) {
      log.error('[BrowserTabs] Error switching tab:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Get all tabs
  ipcMain.handle('browser-tabs:get-all', async () => {
    try {
      const tabs = browserTabsService.getAllTabs();
      const activeTabId = browserTabsService.getActiveTabId();
      return { success: true, tabs, activeTabId };
    } catch (error) {
      log.error('[BrowserTabs] Error getting tabs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Set bounds for the browser view area
  ipcMain.on('browser-tabs:set-bounds', (_event, bounds: Electron.Rectangle) => {
    browserTabsService.setBounds(bounds);
  });

  // Show browser tabs view
  ipcMain.on('browser-tabs:show', () => {
    browserTabsService.show();
  });

  // Hide browser tabs view
  ipcMain.on('browser-tabs:hide', () => {
    browserTabsService.hide();
  });

  // Go back in navigation
  ipcMain.handle('browser-tabs:go-back', async (_event, tabId: string) => {
    try {
      const success = browserTabsService.goBack(tabId);
      return { success };
    } catch (error) {
      log.error('[BrowserTabs] Error going back:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Go forward in navigation
  ipcMain.handle('browser-tabs:go-forward', async (_event, tabId: string) => {
    try {
      const success = browserTabsService.goForward(tabId);
      return { success };
    } catch (error) {
      log.error('[BrowserTabs] Error going forward:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Reload tab
  ipcMain.handle('browser-tabs:reload', async (_event, tabId: string) => {
    try {
      const success = browserTabsService.reload(tabId);
      return { success };
    } catch (error) {
      log.error('[BrowserTabs] Error reloading:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Navigate to URL
  ipcMain.handle('browser-tabs:navigate', async (_event, tabId: string, url: string) => {
    try {
      const success = browserTabsService.navigateTo(tabId, url);
      return { success };
    } catch (error) {
      log.error('[BrowserTabs] Error navigating:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Get visibility state
  ipcMain.handle('browser-tabs:is-visible', async () => {
    return { isVisible: browserTabsService.getIsVisible() };
  });

  // Capture tab screenshot
  ipcMain.handle('browser-tabs:capture-tab', async (_event, tabId: string) => {
    try {
      const dataUrl = await browserTabsService.captureTab(tabId);
      return { success: !!dataUrl, dataUrl };
    } catch (error) {
      log.error('[BrowserTabs] Error capturing tab:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Set tab visibility (without changing panel-level isVisible flag)
  ipcMain.on('browser-tabs:set-tab-visible', (_event, tabId: string, visible: boolean) => {
    browserTabsService.setTabVisible(tabId, visible);
  });

  // Cleanup all tabs before app reload (fire-and-forget from beforeunload)
  ipcMain.on('browser-tabs:cleanup-before-reload', () => {
    try {
      log.info('[BrowserTabs] Cleanup before reload triggered');
      browserTabsService.closeAllTabs();
    } catch (error) {
      log.error('[BrowserTabs] Error during cleanup:', error);
    }
  });
}
