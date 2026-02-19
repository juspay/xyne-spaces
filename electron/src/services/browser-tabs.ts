import { WebContentsView, session, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { getMainWindow } from '../window/manager';

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

interface TabState {
  view: WebContentsView;
  url: string;
  title: string;
  favicon?: string;
}

class BrowserTabsService {
  private tabs: Map<string, TabState> = new Map();
  private activeTabId: string | null = null;
  private bounds: Electron.Rectangle = { x: 0, y: 0, width: 800, height: 600 };
  private isVisible: boolean = false;

  /**
   * Create a new browser tab with the given URL
   */
  createTab(url: string): BrowserTab {
    const tabId = crypto.randomUUID();
    const mainWindow = getMainWindow();

    if (!mainWindow) {
      throw new Error('Main window not available');
    }

    log.info(`[BrowserTabs] Creating tab ${tabId} with URL: ${url}`);

    // Create WebContentsView with persistent session for cookies/auth
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Use persistent session so cookies/auth persist across app restarts
        session: session.fromPartition('persist:browser-tabs'),
      },
    });

    const tabState: TabState = {
      view,
      url,
      title: 'Loading...',
      favicon: undefined,
    };

    this.tabs.set(tabId, tabState);

    // Set up event listeners
    this.setupTabEventListeners(tabId, view, mainWindow);

    // Load the URL
    view.webContents.loadURL(url).catch(err => {
      log.error(`[BrowserTabs] Failed to load URL ${url}:`, err);
    });

    // Switch to the new tab
    this.switchTab(tabId);

    return this.getTabInfo(tabId)!;
  }

  /**
   * Set up event listeners for tab navigation and updates
   */
  private setupTabEventListeners(
    tabId: string,
    view: WebContentsView,
    mainWindow: BrowserWindow,
  ): void {
    const webContents = view.webContents;

    // Track page title changes
    webContents.on('page-title-updated', (_event, title) => {
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.title = title;
        mainWindow.webContents.send('browser-tabs:title-updated', {
          tabId,
          title,
        });
      }
    });

    // Track favicon changes
    webContents.on('page-favicon-updated', (_event, favicons) => {
      const tab = this.tabs.get(tabId);
      if (tab && favicons.length > 0) {
        tab.favicon = favicons[0];
        mainWindow.webContents.send('browser-tabs:favicon-updated', {
          tabId,
          favicon: favicons[0],
        });
      }
    });

    // Track URL changes (for back/forward navigation)
    webContents.on('did-navigate', (_event, url) => {
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.url = url;
        mainWindow.webContents.send('browser-tabs:url-updated', {
          tabId,
          url,
          canGoBack: webContents.canGoBack(),
          canGoForward: webContents.canGoForward(),
        });
      }
    });

    webContents.on('did-navigate-in-page', (_event, url) => {
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.url = url;
        mainWindow.webContents.send('browser-tabs:url-updated', {
          tabId,
          url,
          canGoBack: webContents.canGoBack(),
          canGoForward: webContents.canGoForward(),
        });
      }
    });

    // Track loading state
    webContents.on('did-start-loading', () => {
      mainWindow.webContents.send('browser-tabs:loading-changed', {
        tabId,
        isLoading: true,
      });
    });

    webContents.on('did-stop-loading', () => {
      mainWindow.webContents.send('browser-tabs:loading-changed', {
        tabId,
        isLoading: false,
      });
    });

    // Handle new window requests (e.g., target="_blank" links)
    webContents.setWindowOpenHandler(({ url }) => {
      // Open in a new tab instead of a new window
      this.createTab(url);
      return { action: 'deny' };
    });
  }

  /**
   * Switch to a specific tab
   */
  switchTab(tabId: string): boolean {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return false;
    }

    const tab = this.tabs.get(tabId);
    if (!tab) {
      log.warn(`[BrowserTabs] Tab ${tabId} not found`);
      return false;
    }

    log.info(`[BrowserTabs] Switching to tab ${tabId}`);

    // Hide previous active tab
    if (this.activeTabId && this.activeTabId !== tabId) {
      const prevTab = this.tabs.get(this.activeTabId);
      if (prevTab) {
        try {
          mainWindow.contentView.removeChildView(prevTab.view);
        } catch (e) {
          // View might not be attached
        }
      }
    }

    // Show new tab
    if (this.isVisible) {
      mainWindow.contentView.addChildView(tab.view);
      tab.view.setBounds(this.bounds);
    }

    this.activeTabId = tabId;

    // Notify renderer
    mainWindow.webContents.send('browser-tabs:tab-switched', { tabId });

    return true;
  }

  /**
   * Close a specific tab
   */
  closeTab(tabId: string): boolean {
    const mainWindow = getMainWindow();
    const tab = this.tabs.get(tabId);

    if (!tab) {
      return false;
    }

    log.info(`[BrowserTabs] Closing tab ${tabId}`);

    // Remove from window if attached
    if (mainWindow) {
      try {
        mainWindow.contentView.removeChildView(tab.view);
      } catch (e) {
        // View might not be attached
      }
    }

    // Destroy the web contents
    tab.view.webContents.close();

    // Remove from our map
    this.tabs.delete(tabId);

    // If this was the active tab, switch to another
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        this.switchTab(remainingTabs[remainingTabs.length - 1]);
      }
    }

    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send('browser-tabs:tab-closed', { tabId });
    }

    return true;
  }

  /**
   * Update the bounds for the browser tabs area
   */
  setBounds(bounds: Electron.Rectangle): void {
    this.bounds = bounds;

    // Update active tab bounds
    if (this.activeTabId && this.isVisible) {
      const tab = this.tabs.get(this.activeTabId);
      if (tab) {
        tab.view.setBounds(bounds);
      }
    }
  }

  /**
   * Show the browser tabs view
   */
  show(): void {
    if (this.isVisible) return;

    this.isVisible = true;
    const mainWindow = getMainWindow();

    if (mainWindow && this.activeTabId) {
      const tab = this.tabs.get(this.activeTabId);
      if (tab) {
        mainWindow.contentView.addChildView(tab.view);
        tab.view.setBounds(this.bounds);
      }
    }

    log.info('[BrowserTabs] Browser tabs view shown');
  }

  /**
   * Hide the browser tabs view
   */
  hide(): void {
    if (!this.isVisible) return;

    this.isVisible = false;
    const mainWindow = getMainWindow();

    if (mainWindow && this.activeTabId) {
      const tab = this.tabs.get(this.activeTabId);
      if (tab) {
        try {
          mainWindow.contentView.removeChildView(tab.view);
        } catch (e) {
          // View might not be attached
        }
      }
    }

    log.info('[BrowserTabs] Browser tabs view hidden');
  }

  /**
   * Navigate back in the active tab
   */
  goBack(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (tab && tab.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
      return true;
    }
    return false;
  }

  /**
   * Navigate forward in the active tab
   */
  goForward(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (tab && tab.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
      return true;
    }
    return false;
  }

  /**
   * Reload the specified tab
   */
  reload(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.view.webContents.reload();
      return true;
    }
    return false;
  }

  /**
   * Navigate to a new URL in the specified tab
   */
  navigateTo(tabId: string, url: string): boolean {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.view.webContents.loadURL(url).catch(err => {
        log.error(`[BrowserTabs] Failed to navigate to ${url}:`, err);
      });
      return true;
    }
    return false;
  }

  /**
   * Get info about a specific tab
   */
  getTabInfo(tabId: string): BrowserTab | null {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;

    return {
      id: tabId,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      canGoBack: tab.view.webContents.canGoBack(),
      canGoForward: tab.view.webContents.canGoForward(),
      isLoading: tab.view.webContents.isLoading(),
    };
  }

  /**
   * Get all tabs
   */
  getAllTabs(): BrowserTab[] {
    return Array.from(this.tabs.entries()).map(([id, tab]) => ({
      id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      canGoBack: tab.view.webContents.canGoBack(),
      canGoForward: tab.view.webContents.canGoForward(),
      isLoading: tab.view.webContents.isLoading(),
    }));
  }

  /**
   * Get the active tab ID
   */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /**
   * Check if browser tabs are visible
   */
  getIsVisible(): boolean {
    return this.isVisible;
  }

  /**
   * Capture a screenshot of a tab's current page content.
   * Returns a data URL (base64 PNG) that can be displayed as an <img> in the renderer.
   */
  async captureTab(tabId: string): Promise<string | null> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      log.warn(`[BrowserTabs] Tab ${tabId} not found for capture`);
      return null;
    }

    try {
      const image = await tab.view.webContents.capturePage();
      return image.toDataURL();
    } catch (error) {
      log.error(`[BrowserTabs] Failed to capture tab ${tabId}:`, error);
      return null;
    }
  }

  /**
   * Set visibility of a specific tab's WebContentsView.
   * Unlike show()/hide(), this doesn't change the panel-level isVisible flag.
   * Used for temporarily hiding the native view when overlays/dialogs are open.
   */
  setTabVisible(tabId: string, visible: boolean): void {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;

    const tab = this.tabs.get(tabId);
    if (!tab) return;

    if (visible && this.isVisible && tabId === this.activeTabId) {
      mainWindow.contentView.addChildView(tab.view);
      tab.view.setBounds(this.bounds);
      log.info(`[BrowserTabs] Tab ${tabId} made visible`);
    } else if (!visible) {
      try {
        mainWindow.contentView.removeChildView(tab.view);
        log.info(`[BrowserTabs] Tab ${tabId} hidden`);
      } catch (e) {
        // View might not be attached
      }
    }
  }

  /**
   * Close all tabs (cleanup on app quit)
   */
  closeAllTabs(): void {
    log.info('[BrowserTabs] Closing all tabs');
    for (const tabId of this.tabs.keys()) {
      this.closeTab(tabId);
    }
  }
}

// Export singleton instance
export const browserTabsService = new BrowserTabsService();
