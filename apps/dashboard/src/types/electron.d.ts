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

/** A page from the in-app browsers' history. */
export interface BrowserHistoryPage {
  url: string;
  title: string;
  favicon: string;
}

/** A browser installed on this computer, found without opening any of its data. */
export interface BrowserImportBrowser {
  browser: string;
  browserName: string;
  /** The browser's own app icon, as a PNG data URL; null when its app isn't found. */
  icon: string | null;
}

/** One of a browser's profiles, read once macOS lets Xyne into its data. */
export interface BrowserImportProfile {
  /** `browser:profile`, as an import asks for it. */
  id: string;
  /** The profile's own name: "Person 1", "Work". */
  profile: string;
  /** The account the profile is signed in to its browser with, when it is. */
  account: string | null;
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
  /**
   * The floating incoming-call card. Present only on desktop builds that turn
   * `window.open('', 'xyne-incoming-call:…')` into an always-on-top panel.
   */
  incomingCallWindow?: {
    bringAppToFront: () => void;
    isAppFocused: () => Promise<boolean>;
    /** Whether this window floats the card, and whether a main window exists to. */
    getHost: () => Promise<{ isMain: boolean; mainExists: boolean }>;
    onAppFocusChanged: (callback: (focused: boolean) => void) => () => void;
  };
  onNavigateTo: (callback: (url: string, workspaceId?: string) => void) => () => void;
  onBrowserNewTab: (callback: () => void) => () => void;
  onBrowserFindInPage: (callback: () => void) => () => void;
  /** Browser keys pressed inside a page — back, forward, the address, the tab list,
   *  moving between tabs. Listening is what has the desktop app take them from the
   *  page; absent from a desktop app from before it could. */
  onBrowserCommand?: (callback: (command: string) => void) => () => void;
  /** The in-app browsers' history as suggestions for what is typed; absent from a
   *  desktop app that keeps none. */
  browserHistorySuggest?: (
    typed: string,
    limit?: number,
  ) => Promise<{ searches: string[]; pages: BrowserHistoryPage[] }>;
  /** The sites visited most, one page each. */
  browserHistoryTop?: (limit?: number) => Promise<BrowserHistoryPage[]>;
  clearBrowserHistory?: () => Promise<{ success: boolean }>;
  /** Freezes a page of the in-app browsers out of sight, or wakes it; absent from a
   *  desktop app that can't, whose hidden pages run on. */
  setBrowserPageFrozen?: (pageId: number, frozen: boolean) => Promise<{ success: boolean }>;
  /** Whether the computer runs on battery; absent from a desktop app that can't say. */
  getPowerState?: () => Promise<{ onBattery: boolean }>;
  onPowerChange?: (callback: (state: { onBattery: boolean }) => void) => () => void;
  /** The in-app browsers' pages use too much memory: let go of hidden ones. */
  onBrowserMemoryPressure?: (callback: () => void) => () => void;
  /** Connects ahead to where the address bar is about to go. */
  preconnectBrowserPage?: (url: string) => Promise<void>;
  /** The in-app browser's open tabs or per-site zoom, kept encrypted by the desktop
   *  app; absent from one that can't. */
  getBrowserState?: (key: 'tabs' | 'zoom') => Promise<unknown>;
  setBrowserState?: (key: 'tabs' | 'zoom', value: unknown) => Promise<{ success: boolean }>;
  /** ⌘-scroll over a page of the in-app browsers, asking to zoom it, by the page's id. */
  onBrowserPageZoom?: (callback: (pageId: number, direction: 'in' | 'out') => void) => () => void;
  /** The View menu's zoom (⌘+, ⌘-, ⌘0), for the app to take: its browser's page while
   *  the browser has the keyboard, else the app itself, through zoomApp. Absent from a
   *  desktop app whose menu zooms by itself. */
  onAppZoomRequest?: (callback: (step: 'in' | 'out' | 'reset') => void) => () => void;
  zoomApp?: (step: 'in' | 'out' | 'reset') => void;
  /** Brings this window, and the app, to the front: a floating video's "back to tab". */
  bringAppToFront?: () => void;
  /** The in-app browsers' downloads, as they come in. Listening has the desktop app
   *  save them to Downloads; absent from one that can't. */
  onBrowserDownload?: (callback: (download: unknown) => void) => () => void;
  browserDownloadAction?: (
    id: string,
    action: 'open' | 'show' | 'cancel' | 'pause' | 'resume',
  ) => Promise<{ success: boolean }>;
  onNavigateToTicketThread: (callback: (data: { ticketId: string }) => void) => () => void;
  onAppWindowLimitReached: (callback: (limit: number) => void) => () => void;
  focusHostWebContents?: () => Promise<void>;
  onOpenInBrowserPanel: (
    /** `disposition`: how the page asked — `background-tab` for a ⌘-click or middle
     *  click; absent from a desktop app from before it said. */
    callback: (url: string, sourceWebContentsId?: number, disposition?: string) => void,
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
  onTokenExpired: (callback: (payload?: { url?: string; resourceType?: string }) => void) => void;
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
  /** The browsers on this computer, found without opening their data; unsupported
   *  where importing isn't possible. */
  browserImportBrowsers?: () => Promise<{ supported: boolean; browsers: BrowserImportBrowser[] }>;
  /** One browser's profiles, read from its data: where macOS may ask for access. */
  browserImportProfiles?: (browser: string) => Promise<{
    success: boolean;
    profiles?: BrowserImportProfile[];
    error?: string;
  }>;
  /** Imports one profile's sign-ins (its cookies) into the in-app browsers. */
  browserImport?: (sourceId: string) => Promise<{
    success: boolean;
    imported?: number;
    skipped?: number;
    hosts?: number;
    error?: string;
  }>;
  /** Opens System Settings at Full Disk Access, which Safari's cookies need. */
  /** System Settings where Xyne is let into a browser's data: Files & Folders for
   *  most, Full Disk Access for Safari. */
  openBrowserAccessSettings?: (access: 'app-data' | 'full-disk') => Promise<{ success: boolean }>;
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
  clawOverlay?: {
    setIgnoreMouse: (ignore: boolean) => void;
    setExpanded: (expanded: boolean) => void;
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
    setEnabled: (enabled: boolean) => void;
    onEnabledChanged: (callback: (enabled: boolean) => void) => () => void;
  };
  localHarness?: {
    getStatus: () => Promise<LocalHarnessStatus>;
    detect: () => Promise<LocalHarnessInstallation[]>;
    connect: () => Promise<LocalHarnessStatus>;
    disconnect: () => Promise<LocalHarnessStatus>;
    connectComputer?: () => Promise<LocalHarnessStatus>;
    disconnectComputer?: () => Promise<LocalHarnessStatus>;
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
  computerConnected?: boolean;
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
  /** The page's zoom: 1 at 100%. */
  getZoomFactor?(): number;
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
