const { contextBridge, ipcRenderer } = require('electron');

interface ElectronAuthData {
  workspaces: { id: string; name: string; role: string }[];
  email: string;
  name: string;
  picture?: string;
  userExistsButRemoved: boolean;
}

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: string) => {
    ipcRenderer.send('open-external', url);
  },

  // Get absolute path to webview preload script
  getWebviewPreloadPath: (): string => {
    return ipcRenderer.sendSync('get-webview-preload-path');
  },

  clearAllCookies: () => {
    ipcRenderer.send('clear-all-cookies');
  },

  // Mirrors the main session's Xyne cookies into the `persist:xyne-spaces`
  // partition (used only by Xyne-origin tabs inside the browser panel) so the
  // panel inherits the main-app sign-in. Safe to call with any Xyne URL —
  // cookie domain/sameSite attributes are preserved and enforced by Chromium.
  syncXyneCookiesToBrowserPanel: (url: string): Promise<void> => {
    return ipcRenderer.invoke('sync-xyne-cookies-to-browser-panel', url);
  },

  setBadgeCount: (count: number) => {
    ipcRenderer.send('set-badge-count', count);
  },

  showNotification: (data: { title: string; body: string; actionUrl?: string }) => {
    ipcRenderer.send('show-notification', data);
  },

  showCallNotification: (data: {
    callId: string;
    callerName: string;
    callerEmail: string;
    callType: 'AUDIO' | 'VIDEO';
    callerPicture?: string;
  }) => {
    ipcRenderer.send('show-call-notification', data);
  },

  closeCallNotification: (callId: string) => {
    ipcRenderer.send('close-call-notification', callId);
  },

  onCallNotificationClicked: (callback: (data: { callId: string }) => void) => {
    const listener = (_event: unknown, data: { callId: string }) => callback(data);
    ipcRenderer.on('call-notification-clicked', listener);
    return () => ipcRenderer.removeListener('call-notification-clicked', listener);
  },

  onCallAction: (callback: (data: { callId: string; action: 'accept' | 'reject' }) => void) => {
    const listener = (_event: unknown, data: { callId: string; action: 'accept' | 'reject' }) => callback(data);
    ipcRenderer.on('call-action', listener);
    return () => ipcRenderer.removeListener('call-action', listener);
  },

  onNavigateTo: (callback: (url: string) => void) => {
    const listener = (_event: unknown, url: string) => callback(url);
    ipcRenderer.on('navigate-to', listener);
    return () => ipcRenderer.removeListener('navigate-to', listener);
  },
  onBrowserNewTab: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('browser-new-tab', listener);
    return () => ipcRenderer.removeListener('browser-new-tab', listener);
  },
  onBrowserFindInPage: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('browser-find-in-page', listener);
    return () => ipcRenderer.removeListener('browser-find-in-page', listener);
  },

  onNavigateToTicketThread: (callback: (data: { ticketId: string }) => void) => {
    const listener = (_event: unknown, data: { ticketId: string }) => callback(data);
    ipcRenderer.on('navigate-to-ticket-thread', listener);
    return () => ipcRenderer.removeListener('navigate-to-ticket-thread', listener);
  },

  onOpenXyneAIWithContext: (callback: (data: { text: string; url: string; domain: string; title: string; timestamp: number }) => void) => {
    const listener = (_event: unknown, data: { text: string; url: string; domain: string; title: string; timestamp: number }) => callback(data);
    ipcRenderer.on('open-xyne-ai-with-context', listener);
    return () => ipcRenderer.removeListener('open-xyne-ai-with-context', listener);
  },

  onOpenInBrowserPanel: (callback: (url: string) => void) => {
    const listener = (_event: unknown, url: string) => callback(url);
    ipcRenderer.on('open-in-browser-panel', listener);
    return () => ipcRenderer.removeListener('open-in-browser-panel', listener);
  },

  onReloadActiveBrowserTab: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('reload-active-browser-tab', listener);
    return () => ipcRenderer.removeListener('reload-active-browser-tab', listener);
  },

  onAuthSuccess: (callback: (data?: ElectronAuthData) => void) => {
    const listener = (_event: unknown, data?: ElectronAuthData) => callback(data);
    ipcRenderer.on('auth:success', listener);
  },

  onMTLSAuthSuccess: (callback: (data?: ElectronAuthData) => void) => {
    const listener = (_event: unknown, data?: ElectronAuthData) => callback(data);
    ipcRenderer.on('auth:mtls-success', listener);
  },

  onTokenExpired: (callback: () => void) => {
    ipcRenderer.on('auth:token-expired', callback);
  },
  openPreviewWindow: (url: string, userAgent?: string) => {
    ipcRenderer.send('open-preview-window', url, userAgent);
  },
  showBrowserView: (config: {
    url: string;
    userAgent: string;
    bounds: { x: number; y: number; width: number; height: number };
  }) => {
    ipcRenderer.send('show-browser-view', config);
  },
  hideBrowserView: () => {
    ipcRenderer.send('hide-browser-view');
  },
  reloadApp: () => {
    ipcRenderer.send('reload-app');
  },
  toggleCompactMode: () => {
    ipcRenderer.send('toggle-compact-mode');
  },
  onWindowModeChanged: (callback: (data: { compact: boolean }) => void) => {
    const listener = (_event: unknown, data: { compact: boolean }) => callback(data);
    ipcRenderer.on('window-mode-changed', listener);
    return () => ipcRenderer.removeListener('window-mode-changed', listener);
  },
  updateBrowserViewBounds: (data: { bounds: Electron.Rectangle }) =>
    ipcRenderer.send('update-browser-view-bounds', data),
  generateKeys: (label: string) => ipcRenderer.invoke('generate-keys', label),
  generateCSR: (label: string, subjectCN: string) => ipcRenderer.invoke('generate-csr', label, subjectCN),
  storeCertificate: (pem: string) => ipcRenderer.invoke('store-certificate', pem),
  installRootCA: (pem: string) => ipcRenderer.invoke('install-root-ca', pem),
  deleteKeys: (commonName: string) => ipcRenderer.invoke('delete-keys', commonName),
  checkKeys: (commonName: string) => ipcRenderer.invoke('check-keys', commonName),
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),
  setUserEmail: (email: string) => ipcRenderer.send('set-user-email', email),
  getClientSessionId: () => ipcRenderer.invoke('logger:get-client-session-id'),

  // Browser Settings APIs
  getBrowserSettings: () => ipcRenderer.invoke('get-browser-settings'),
  setBrowserSettings: (settings: any) => ipcRenderer.invoke('set-browser-settings', settings),
  clearSiteData: () => ipcRenderer.invoke('clear-site-data'),

  // File Management APIs
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),

  // Code Server APIs
  codeServer: {
    start: () => ipcRenderer.invoke('code-server:start'),
    stop: () => ipcRenderer.invoke('code-server:stop'),
    restart: () => ipcRenderer.invoke('code-server:restart'),
    getStatus: () => ipcRenderer.invoke('code-server:status'),
    getUrl: () => ipcRenderer.invoke('code-server:get-url'),
    downloadBinary: () => ipcRenderer.invoke('code-server:download-binary'),
    isBinaryInstalled: () => ipcRenderer.invoke('code-server:is-binary-installed'),
    onStatusChange: (callback: (data: { isRunning: boolean; url: string | null }) => void) => {
      const listener = (_event: unknown, data: { isRunning: boolean; url: string | null }) => callback(data);
      ipcRenderer.on('code-server:status-change', listener);
      return () => ipcRenderer.removeListener('code-server:status-change', listener);
    },
    // Git workspace APIs (for workflow executions)
    cloneBranch: (repoUrl: string, branch: string, commitHash: string | undefined, executionId: string) =>
      ipcRenderer.invoke('code-server:clone-branch', repoUrl, branch, commitHash, executionId),
    pullUpdates: (executionId: string, branch: string, repoUrl: string) =>
      ipcRenderer.invoke('code-server:pull-updates', executionId, branch, repoUrl),
    getWorkspacePath: (executionId: string) =>
      ipcRenderer.invoke('code-server:get-workspace-path', executionId),
    workspaceExists: (executionId: string) =>
      ipcRenderer.invoke('code-server:workspace-exists', executionId),
    getUrlWithFolder: (folderPath: string) =>
      ipcRenderer.invoke('code-server:get-url-with-folder', folderPath),
    openFolderDialog: () =>
      ipcRenderer.invoke('code-server:open-folder-dialog'),
    deleteWorkspace: (executionId: string) =>
      ipcRenderer.invoke('code-server:delete-workspace', executionId),
    listWorkspaces: () =>
      ipcRenderer.invoke('code-server:list-workspaces'),

    // Xyne-spaces repo management APIs (for ticket IDE integration)
    getXyneSpacesDir: () =>
      ipcRenderer.invoke('code-server:get-xyne-spaces-dir'),
    listRepos: () =>
      ipcRenderer.invoke('code-server:list-repos'),
    getRepoPath: (repoName: string) =>
      ipcRenderer.invoke('code-server:get-repo-path', repoName),
    getRepoStatus: (repoPath: string) =>
      ipcRenderer.invoke('code-server:get-repo-status', repoPath),
    stashChanges: (repoPath: string) =>
      ipcRenderer.invoke('code-server:stash-changes', repoPath),
    checkoutBranch: (repoPath: string, branchName: string, baseBranch?: string) =>
      ipcRenderer.invoke('code-server:checkout-branch', repoPath, branchName, baseBranch),
    prepareForTicket: (repoUrl: string, baseBranch: string, ticketBranchName: string) =>
      ipcRenderer.invoke('code-server:prepare-for-ticket', repoUrl, baseBranch, ticketBranchName),
    hasActiveSessions: () =>
      ipcRenderer.invoke('code-server:has-active-sessions'),
    getActiveSessionCount: () =>
      ipcRenderer.invoke('code-server:get-active-session-count'),
  },

  // Docs Publish APIs
  docsPublish: {
    getStatus: () =>
      ipcRenderer.invoke('docs-publish:get-status'),
    clearOutputDir: () =>
      ipcRenderer.invoke('docs-publish:clear-output-dir'),
    getOutputDir: () =>
      ipcRenderer.invoke('docs-publish:get-output-dir'),
  },

  // Log listener
  onLog: (callback: (message: any) => void) => {
    const listener = (_event: unknown, message: any) => callback(message);
    ipcRenderer.on('electron-log', listener);
    return () => ipcRenderer.removeListener('electron-log', listener);
  },

  // Bundle version API
  getBundleVersion: () => ipcRenderer.invoke('get-bundle-version'),

  // App update APIs
  onAppUpdateAvailable: (callback: (data: { currentVersion: string; latestVersion: string }) => void) => {
    const listener = (_event: unknown, data: { currentVersion: string; latestVersion: string }) => callback(data);
    ipcRenderer.on('app-update-available', listener);
    return () => ipcRenderer.removeListener('app-update-available', listener);
  },
  applyAppUpdate: () => ipcRenderer.send('apply-app-update'),
  requestAllMediaPermissions: () =>
    ipcRenderer.invoke('request-all-media-permissions'),

  // Generic IPC send (used by standalone HTML windows like meeting-popup)
  ipcSend: (channel: string, ...args: unknown[]) => {
    const allowed = ['meeting-popup:content-height', 'recording-pill:content-size', 'recording-pill:recording-stopped'];
    if (allowed.includes(channel)) ipcRenderer.send(channel, ...args);
  },

  // Meeting Detector APIs
  meetingDetector: {
    onStartRecordingFromMeeting: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('meeting:start-recording', listener);
      return () => ipcRenderer.removeListener('meeting:start-recording', listener);
    },
    onStopRecordingFromMeeting: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('meeting:stop-recording', listener);
      return () => ipcRenderer.removeListener('meeting:stop-recording', listener);
    },
    setEnabled: (enabled: boolean) => {
      ipcRenderer.send('meeting-detection:set-enabled', enabled);
    },
  },

  // Meeting popup (used by the popup window itself)
  meetingPopup: {
    onShow: (callback: (data: { app: string; startedAt: string }) => void) => {
      const listener = (_event: unknown, data: { app: string; startedAt: string }) => callback(data);
      ipcRenderer.on('meeting-popup:show', listener);
      return () => ipcRenderer.removeListener('meeting-popup:show', listener);
    },
    onUpdate: (callback: (data: { app: string; startedAt: string }) => void) => {
      const listener = (_event: unknown, data: { app: string; startedAt: string }) => callback(data);
      ipcRenderer.on('meeting-popup:update', listener);
      return () => ipcRenderer.removeListener('meeting-popup:update', listener);
    },
    onHide: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('meeting-popup:hide', listener);
      return () => ipcRenderer.removeListener('meeting-popup:hide', listener);
    },
    dismiss: () => ipcRenderer.send('meeting-popup:dismiss'),
    startRecording: () => ipcRenderer.send('meeting-popup:start-recording'),
  },

  // Screen Picker — in-app overlay instead of macOS native picker
  screenPicker: {
    onShow: (callback: (data: { sources: { id: string; name: string; thumbnail: string; displayId: string; type: 'screen' | 'window' }[]; permissionError: 'denied' | null }) => void) => {
      const listener = (_event: unknown, data: { sources: { id: string; name: string; thumbnail: string; displayId: string; type: 'screen' | 'window' }[]; permissionError: 'denied' | null }) => callback(data);
      ipcRenderer.on('screen-picker:show', listener);
      return () => ipcRenderer.removeListener('screen-picker:show', listener);
    },
    onClose: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('screen-picker:close', listener);
      return () => ipcRenderer.removeListener('screen-picker:close', listener);
    },
    select: (sourceId: string, shareAudio: boolean) => {
      ipcRenderer.send('screen-picker:select', sourceId, shareAudio);
    },
    cancel: () => {
      ipcRenderer.send('screen-picker:cancel');
    },
    setEnabled: (enabled: boolean) => {
      ipcRenderer.send('screen-picker:set-enabled', enabled);
    },
  },

  // Recording pill (persistent floating pill while recording is active)
  recordingPill: {
    onShow: (callback: (startTime: number) => void) => {
      const listener = (_event: unknown, startTime: number) => callback(startTime);
      ipcRenderer.on('recording-pill:show', listener);
      return () => ipcRenderer.removeListener('recording-pill:show', listener);
    },
    onHide: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('recording-pill:hide', listener);
      return () => ipcRenderer.removeListener('recording-pill:hide', listener);
    },
    stopRecording: () => ipcRenderer.send('recording-pill:stop-recording'),
    cancelRecording: () => ipcRenderer.send('recording-pill:cancel-recording'),
  },
});

