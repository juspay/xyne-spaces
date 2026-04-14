export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string; // base64 data URL
  displayId: string;
  type: 'screen' | 'window';
}

export interface ElectronAPI {
  openExternal: (url: string) => void;
  getWebviewPreloadPath?: () => string;
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
  onBrowserNewTab: (callback: () => void) => () => void;
  onBrowserFindInPage: (callback: () => void) => () => void;
  onNavigateToTicketThread: (callback: (data: { ticketId: string }) => void) => () => void;
  onOpenInBrowserPanel: (callback: (url: string) => void) => () => void;
  onReloadActiveBrowserTab: (callback: () => void) => () => void;
  onOpenXyneAIWithContext: (
    callback: (data: {
      text: string;
      url: string;
      domain: string;
      title: string;
      timestamp: number;
    }) => void,
  ) => () => void;
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
  getBrowserSettings: () => Promise<{ javascript: boolean; popups: boolean }>;
  setBrowserSettings: (
    settings: Partial<{ javascript: boolean; popups: boolean }>,
  ) => Promise<{ javascript: boolean; popups: boolean }>;
  clearSiteData: () => Promise<{ success: boolean }>;
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
  ipcSend?: (channel: string, ...args: unknown[]) => void;
  meetingDetector?: {
    onStartRecordingFromMeeting: (callback: () => void) => () => void;
    setEnabled: (enabled: boolean) => void;
  };
  meetingPopup?: {
    onShow: (callback: (data: { app: string; startedAt: string }) => void) => () => void;
    onUpdate: (callback: (data: { app: string; startedAt: string }) => void) => () => void;
    onHide: (callback: () => void) => () => void;
    dismiss: () => void;
    startRecording: () => void;
  };
  screenPicker?: {
    onShow: (
      callback: (data: { sources: ScreenSource[]; permissionError: 'denied' | null }) => void,
    ) => () => void;
    onClose: (callback: () => void) => () => void;
    select: (sourceId: string, shareAudio: boolean) => void;
    cancel: () => void;
    setEnabled: (enabled: boolean) => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          preload?: string;
          allowpopups?: string;
          useragent?: string;
          disablewebsecurity?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
