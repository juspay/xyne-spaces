import { CallType } from '@xyne/shared';
export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string; // base64 data URL
  displayId: string;
  type: 'screen' | 'window';
}

export interface ErrorReportNativeLog {
  fileName: string;
  content: string;
}

export interface ErrorReportRecordingInfo {
  state: 'idle' | 'recording';
  elapsedSeconds?: number;
}

export interface ElectronAPI {
  openExternal: (url: string) => void;
  getWebviewPreloadPath?: () => string;
  // Only exposed by the webview preload (`electron/src/webview-preload.js`),
  // not by the main preload. Presence of this function is used to detect
  // "we're rendering inside the browser-panel webview" — see
  // `dashboard/src/hooks/useIsInPanelWebview.ts`.
  sendToHost?: (channel: string, data?: unknown) => void;
  clearAllCookies: () => void;
  syncXyneCookiesToBrowserPanel?: (url: string) => Promise<void>;
  setDynamicHeaders?: (headers: Record<string, string>) => Promise<void>;
  setBadgeCount: (count: number) => void;
  showNotification: (data: {
    title: string;
    body: string;
    actionUrl?: string;
    workspaceId?: string;
  }) => void;
  showCallNotification: (data: {
    callId: string;
    callerName: string;
    callerEmail: string;
    callType: CallType;
    callerPicture?: string;
    body?: string;
    /** Suppresses the OS notification sound; the dock still bounces. */
    silent?: boolean;
  }) => void;
  closeCallNotification: (callId: string) => void;
  onCallNotificationClicked: (callback: (data: { callId: string }) => void) => () => void;
  onCallAction: (
    callback: (data: { callId: string; action: 'accept' | 'reject' }) => void,
  ) => () => void;
  focusApp: () => void;
  onNavigateTo: (callback: (url: string, workspaceId?: string) => void) => () => void;
  onBrowserNewTab: (callback: () => void) => () => void;
  onBrowserFindInPage: (callback: () => void) => () => void;
  onNavigateToTicketThread: (callback: (data: { ticketId: string }) => void) => () => void;
  onAppWindowLimitReached: (callback: (limit: number) => void) => () => void;
  focusHostWebContents?: () => Promise<void>;
  onOpenInBrowserPanel: (
    callback: (url: string, sourceWebContentsId?: number) => void,
  ) => () => void;
  // Optional: absent on Electron builds older than the one that added it.
  onLinkOpenedExternal?: (callback: (url: string) => void) => () => void;
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
  deleteKeys: (commonName: string) => Promise<void>;
  checkKeys: (commonName: string) => Promise<boolean>;
  getDeviceInfo: () => Promise<unknown>;
  setUserEmail: (email: string) => void;
  getClientSessionId: () => Promise<string>;
  toggleCompactMode: () => void;
  getBrowserSettings: () => Promise<{ popups: boolean; openLinksExternally: boolean }>;
  setBrowserSettings: (
    settings: Partial<{ popups: boolean; openLinksExternally: boolean }>,
  ) => Promise<{ popups: boolean; openLinksExternally: boolean }>;
  clearSiteData: () => Promise<{ success: boolean }>;
  captureAppWindow?: (maxWidth?: number) => Promise<{ data: string }>;
  readClipboardText?: () => Promise<string>;
  writeClipboardText?: (text: string) => Promise<{ success: boolean }>;
  browserImportAvailable?: () => Promise<{ available: boolean }>;
  importChromeCookies?: () => Promise<{
    success: boolean;
    imported?: number;
    skipped?: number;
    hosts?: number;
    error?: string;
  }>;
  exportCanvasMarkdown?: (
    fileName: string,
    content: string,
  ) => Promise<{ saved: boolean; filePath?: string }>;
  exportCanvasPdf?: (
    fileName: string,
    html: string,
  ) => Promise<{ saved: boolean; filePath?: string }>;
  onWindowModeChanged: (callback: (data: { compact: boolean }) => void) => () => void;
  onRecordingSystemSuspend: (callback: () => void) => () => void;
  onRecordingStopForTeardown?: (callback: () => void) => () => void;
  onCallStopForTeardown?: (callback: () => void) => () => void;
  onRecordingResumeRequest?: (callback: () => void) => () => void;
  onRecordingPauseRequest?: (callback: () => void) => () => void;
  onLog: (callback: (message: { data?: unknown[] }) => void) => () => void;
  getErrorReportNativeLogs?: () => Promise<ErrorReportNativeLog[]>;
  getErrorReportScreenSources?: () => Promise<{
    sources: ScreenSource[];
    permissionError: 'denied' | null;
  }>;
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
    onStopRecordingFromMeeting: (callback: () => void) => () => void;
    setEnabled: (enabled: boolean) => void;
    /** Fires with the meeting on detection and with null when it ends. */
    onMeetingStateChanged: (
      callback: (meeting: { app: string; startedAt: string } | null) => void,
    ) => () => void;
    /** Seeds state on mount — detection broadcasts are not replayed. */
    getCurrentMeeting: () => Promise<{ app: string; startedAt: string } | null>;
  };
  /**
   * Raw mic activity, meeting app or not. Separate from `meetingDetector`
   * because the meeting-detection preference does not gate it: this is what
   * keeps a call quiet while the user is talking to someone else.
   */
  micMonitor?: {
    onStateChanged: (callback: (active: boolean) => void) => () => void;
    getState: () => Promise<boolean>;
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
  recordingPill?: {
    onShow: (
      callback: (state: {
        startTime: number;
        paused: boolean;
        pauseStartedAt: number | null;
        accumulatedPausedMs: number;
      }) => void,
    ) => () => void;
    onHide: (callback: () => void) => () => void;
    onThemeChanged: (callback: (theme: 'light' | 'dark') => void) => () => void;
    onMinimizedChanged: (callback: (minimized: boolean) => void) => () => void;
    stopRecording: () => void;
    resumeRecording: () => void;
    openApp: () => void;
    setIgnoreMouse: (ignore: boolean) => void;
    dragStart: () => void;
    dragEnd: () => void;
  };
  platform?: string;
  tray?: {
    getVisible: () => Promise<boolean>;
    setVisible: (visible: boolean) => void;
    onVisibleChanged: (callback: (visible: boolean) => void) => () => void;
  };
  recordingPillSettings?: {
    getEnabled: () => Promise<boolean>;
    setEnabled: (enabled: boolean) => void;
    onEnabledChanged: (callback: (enabled: boolean) => void) => () => void;
  };
  clawCompletion?: {
    onShow: (
      callback: (payload: {
        outcome: 'idle' | 'needs-input' | 'error';
        preview: string | null;
        dark: boolean;
      }) => void,
    ) => () => void;
    onHide: (callback: () => void) => () => void;
    open: () => void;
    dismiss: () => void;
  };
  clawOverlay?: {
    setIgnoreMouse: (ignore: boolean) => void;
    setExpanded: (expanded: boolean) => void;
    dismissSpotlight: () => void;
    setSpotlightHeight: (height: number) => void;
    dragStart: () => void;
    dragEnd: () => void;
    setSessionState: (state: {
      status: 'idle' | 'running' | 'needs-input' | 'error';
      conversationId: string | null;
      preview: string | null;
    }) => void;
    onMode: (callback: (mode: 'pill' | 'spotlight') => void) => () => void;
    focus: () => void;
    blur: () => void;
    openInMain: (pathname: string) => void;
    onVisibility: (callback: (visible: boolean) => void) => () => void;
    setPanelHeight: (height: number) => void;
    onPanelHeight: (callback: (height: number) => void) => () => void;
    reconcile: (rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => Promise<boolean | null>;
    getEnabled: () => Promise<boolean>;
    getShortcut: () => Promise<string | null>;
    setEnabled: (enabled: boolean) => void;
    onEnabledChanged: (callback: (enabled: boolean) => void) => () => void;
  };
  localHarness?: {
    getStatus: () => Promise<LocalHarnessStatus>;
    detect: () => Promise<LocalHarnessInstallation[]>;
    connect: () => Promise<LocalHarnessStatus>;
    disconnect: () => Promise<LocalHarnessStatus>;
    setProviderEnabled: (
      provider: LocalHarnessInstallation['provider'],
      enabled: boolean,
    ) => Promise<LocalHarnessStatus>;
    pickFolder?: () => Promise<LocalHarnessFolder | null>;
    listFolders?: () => Promise<Array<{ path: string; name: string }>>;
    onPageToolRequest?: (
      listener: (req: { id: string; toolName: string; args: Record<string, unknown> }) => void,
    ) => () => void;
    sendPageToolResult?: (
      id: string,
      result: { ok: boolean; content: string; image?: { data: string; mimeType: string } },
    ) => void;
  };
  saveErrorReportFile?(
    fileName: string,
    buffer: ArrayBuffer | null,
    sourcePath: string | null,
  ): Promise<{ saved: boolean }>;
  startErrorReportRecording?(sourceId: string, withMic: boolean): Promise<void>;
  stopErrorReportRecording?(): Promise<{ filePath: string; recordingToken: string }>;
  getErrorReportRecordingState?(): Promise<ErrorReportRecordingInfo>;
  readErrorReportRecordingFile?(recordingToken: string): Promise<ArrayBuffer>;
  cleanupErrorReportRecording?(filePath: string): Promise<void>;
  onErrorReportRecordingProgress?(callback: (data: { elapsedSeconds: number }) => void): () => void;
}

export interface LocalHarnessFolder {
  path: string;
  name: string;
  branch?: string;
  remote?: string;
}

export interface LocalHarnessInstallation {
  provider: 'claude-code' | 'codex-cli';
  binaryPath: string;
  version: string;
  authenticated: boolean;
  /** Whether the user connected this harness on this device. */
  enabled?: boolean;
}

export interface LocalHarnessStatus {
  supported: boolean;
  connected: boolean;
  deviceId: string | null;
  deviceName: string;
  platform: string;
  installations: LocalHarnessInstallation[];
  lastError: string | null;
  containerRuntime?: { available: boolean; reason?: string };
}

export interface ElectronWebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void> | void;
  getURL(): string;
  getTitle(): string;
  reload(): void;
  stop(): void;
  focus(): void;
  copy(): void;
  getWebContentsId?: () => number;
  isLoading(): boolean;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  sendInputEvent(event: Record<string, unknown>): Promise<void> | void;
  capturePage(): Promise<{
    toDataURL(): string;
    toPNG(): Uint8Array;
    getSize(): { width: number; height: number };
    resize(options: { width?: number; height?: number }): {
      toDataURL(): string;
      getSize(): { width: number; height: number };
    };
  }>;
  setZoomFactor?: (factor: number) => void;
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
