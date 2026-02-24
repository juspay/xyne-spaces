export interface ElectronAPI {
  openExternal: (url: string) => void;
  clearAllCookies: () => void;
  setBadgeCount: (count: number) => void;
  showNotification: (data: { title: string; body: string; actionUrl?: string }) => void;
  showCallNotification: (data: {
    callId: string;
    callerName: string;
    callerEmail: string;
    callType: 'AUDIO' | 'VIDEO';
    callerPicture?: string;
  }) => void;
  closeCallNotification: (callId: string) => void;
  onCallNotificationClicked: (callback: (data: { callId: string }) => void) => () => void;
  onCallAction: (
    callback: (data: { callId: string; action: 'accept' | 'reject' }) => void,
  ) => () => void;
  onNavigateTo: (callback: (url: string) => void) => () => void;
  onNavigateToTicketThread: (callback: (data: { ticketId: string }) => void) => () => void;
  onOpenInBrowserPanel: (callback: (url: string) => void) => () => void;
  onAuthSuccess: (callback: () => void) => void;
  onTokenExpired: (callback: () => void) => void;
  openPreviewWindow: (url: string, userAgent?: string) => void;
  showBrowserView: (config: {
    url: string;
    userAgent: string;
    bounds: { x: number; y: number; width: number; height: number };
  }) => void;
  hideBrowserView: () => void;
  updateBrowserViewBounds: (config: {
    bounds: { x: number; y: number; width: number; height: number };
  }) => void;
  generateKeys: (label: string) => Promise<void>;
  generateCSR: (label: string, subjectCN: string) => Promise<string>;
  storeCertificate: (pem: string) => Promise<void>;
  installRootCA: (pem: string) => Promise<void>;
  deleteKeys: (commonName: string) => Promise<void>;
  checkKeys: (commonName: string) => Promise<boolean>;
  getDeviceInfo: () => Promise<unknown>;
  setUserEmail: (email: string) => void;
  getClientSessionId: () => Promise<string>;
  toggleCompactMode: () => void;
  onWindowModeChanged: (callback: (data: { compact: boolean }) => void) => () => void;
  codeServer: {
    start: () => Promise<{ success: boolean; url?: string; error?: string }>;
    stop: () => Promise<{ success: boolean; error?: string }>;
    restart: () => Promise<{ success: boolean; url?: string; error?: string }>;
    getStatus: () => Promise<{
      isRunning: boolean;
      isDownloading: boolean;
      port: number | null;
      url: string | null;
      pid: number | null;
      binaryInstalled: boolean;
      error: string | null;
    }>;
    getUrl: () => Promise<string | null>;
    downloadBinary: () => Promise<{ success: boolean; error?: string }>;
    isBinaryInstalled: () => Promise<boolean>;
    onStatusChange: (
      callback: (data: { isRunning: boolean; url: string | null }) => void,
    ) => () => void;
    // Git workspace APIs (for workflow executions)
    cloneBranch: (
      repoUrl: string,
      branch: string,
      commitHash: string | undefined,
      executionId: string,
    ) => Promise<{ success: boolean; workspacePath: string; error?: string }>;
    pullUpdates: (
      executionId: string,
      branch: string,
      repoUrl: string,
    ) => Promise<{ success: boolean; workspacePath?: string; error?: string }>;
    getWorkspacePath: (executionId: string) => Promise<string>;
    workspaceExists: (executionId: string) => Promise<boolean>;
    getUrlWithFolder: (folderPath: string) => Promise<string | null>;
    openFolderDialog: () => Promise<string | null>;
    deleteWorkspace: (executionId: string) => Promise<{ success: boolean; error?: string }>;
    listWorkspaces: () => Promise<string[]>;

    // Xyne-spaces repo management APIs (for ticket IDE integration)
    getXyneSpacesDir: () => Promise<string>;
    listRepos: () => Promise<string[]>;
    getRepoPath: (repoName: string) => Promise<string>;
    getRepoStatus: (repoPath: string) => Promise<{
      hasUncommittedChanges: boolean;
      branch: string;
      error?: string;
    }>;
    stashChanges: (repoPath: string) => Promise<{
      success: boolean;
      hadChanges: boolean;
      error?: string;
    }>;
    checkoutBranch: (
      repoPath: string,
      branchName: string,
      baseBranch?: string,
    ) => Promise<{ success: boolean; created: boolean; error?: string }>;
    prepareForTicket: (
      repoUrl: string,
      baseBranch: string,
      ticketBranchName: string,
    ) => Promise<{
      success: boolean;
      workspacePath: string;
      stashedChanges: boolean;
      error?: string;
    }>;
    hasActiveSessions: () => Promise<boolean>;
    getActiveSessionCount: () => Promise<number>;
  };
  browserTabs: {
    create: (url: string) => Promise<{
      success: boolean;
      tab?: BrowserTab;
      error?: string;
    }>;
    close: (tabId: string) => Promise<{ success: boolean; error?: string }>;
    switch: (tabId: string) => Promise<{ success: boolean; error?: string }>;
    getAll: () => Promise<{
      success: boolean;
      tabs: BrowserTab[];
      activeTabId: string | null;
      error?: string;
    }>;
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
    show: () => void;
    hide: () => void;
    goBack: (tabId: string) => Promise<{ success: boolean; error?: string }>;
    goForward: (tabId: string) => Promise<{ success: boolean; error?: string }>;
    reload: (tabId: string) => Promise<{ success: boolean; error?: string }>;
    navigate: (tabId: string, url: string) => Promise<{ success: boolean; error?: string }>;
    isVisible: () => Promise<{ isVisible: boolean }>;
    onTitleUpdated: (callback: (data: { tabId: string; title: string }) => void) => () => void;
    onFaviconUpdated: (callback: (data: { tabId: string; favicon: string }) => void) => () => void;
    onUrlUpdated: (
      callback: (data: {
        tabId: string;
        url: string;
        canGoBack: boolean;
        canGoForward: boolean;
      }) => void,
    ) => () => void;
    onLoadingChanged: (
      callback: (data: { tabId: string; isLoading: boolean }) => void,
    ) => () => void;
    onTabSwitched: (callback: (data: { tabId: string }) => void) => () => void;
    onTabClosed: (callback: (data: { tabId: string }) => void) => () => void;
    captureTab: (tabId: string) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
    setTabVisible: (tabId: string, visible: boolean) => void;
    cleanupBeforeReload: () => Promise<{ success: boolean; error?: string }>;
  };
  onLog: (callback: (message: { data?: unknown[] }) => void) => () => void;
  getBundleVersion: () => Promise<string | null>;
  onAppUpdateAvailable: (
    callback: (data: {
      currentVersion: string;
      latestVersion: string;
      loadType: 'manual' | 'auto';
    }) => void,
  ) => () => void;
  applyAppUpdate: () => void;
  requestAllMediaPermissions: () => Promise<{ microphone: boolean; camera: boolean }>;
}

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
