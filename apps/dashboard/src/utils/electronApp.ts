import { logger, Event as LogEvent } from './logger';
import type { CSSProperties } from 'react';
import type { ElectronAPI } from '../types/electron';
import type { NavigateFunction } from 'react-router-dom';

interface ElectronWindow extends Window {
  electronAPI?: ElectronAPI;
  electron?: unknown;
}

/**
 * Utility function to detect if the application is running inside an Electron app
 * @returns {boolean} true if running in Electron, false otherwise
 */
export const isElectronApp = (): boolean => {
  // Check if we're in a browser environment first
  if (typeof window === 'undefined') {
    return false;
  }

  // Method 1: Check for electron-specific APIs in window object
  const electronWindow = window as ElectronWindow;
  if (electronWindow.electronAPI || electronWindow.electron) {
    return true;
  }

  // Method 2: Check user agent for Electron
  if (navigator.userAgent && navigator.userAgent.toLowerCase().includes('electron')) {
    return true;
  }

  // Method 3: Check if process.versions.electron exists (if node integration is enabled)
  try {
    if (typeof process !== 'undefined' && process.versions && process.versions['electron']) {
      return true;
    }
  } catch {
    // process might not be available in renderer process
  }

  return false;
};

/**
 * `-webkit-app-region` drag regions let users move (and double-click to zoom) the
 * frameless Electron window by dragging app chrome such as the top nav strip, the
 * sidebar's traffic-light spacer and the conversation header. Mark interactive
 * children with {@link APP_NO_DRAG_STYLE} so clicks still work inside a drag region.
 *
 * These are computed once and left empty on the web, where `-webkit-app-region`
 * has no effect but the empty style keeps text selection / pointer behaviour clean.
 */
export const APP_DRAG_STYLE: CSSProperties = isElectronApp()
  ? ({ WebkitAppRegion: 'drag' } as CSSProperties)
  : {};

export const APP_NO_DRAG_STYLE: CSSProperties = isElectronApp()
  ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties)
  : {};

export const isStandaloneWindow = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.location.pathname.startsWith('/newWindow/');
};

export const isElectronStandaloneWindow = (): boolean => {
  return isElectronApp() && isStandaloneWindow();
};

export const CALL_WINDOW_PATH_PREFIX = '/newWindow/call/';

export const isCallWindow = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.location.pathname.startsWith(CALL_WINDOW_PATH_PREFIX);
};

const STANDALONE_SUPPORTED_ROUTES = ['/chat/', '/call/'];

export const isStandaloneSupportedPath = (path: string): boolean => {
  return STANDALONE_SUPPORTED_ROUTES.some(route => path.startsWith(route));
};

export const toStandalonePath = (path: string): string => {
  if (path.startsWith('/newWindow/')) {
    return path;
  }
  try {
    const url = new URL(path, window.location.origin);
    return `/newWindow${url.pathname}${url.search}${url.hash}`;
  } catch {
    return `/newWindow${path}`;
  }
};

export const toRegularPath = (path: string): string => {
  if (path.startsWith('/newWindow/')) {
    return path.replace('/newWindow', '');
  }
  return path;
};

export const getNavigationPath = (path: string): string => {
  const normalizedPath = toRegularPath(path);

  if (isStandaloneWindow()) {
    return toStandalonePath(normalizedPath);
  }
  return normalizedPath;
};

export interface StandaloneNavigateOptions {
  event?: React.MouseEvent | MouseEvent | undefined;

  state?: unknown;

  replace?: boolean;
}

type ModifierEvent = Pick<MouseEvent, 'metaKey' | 'ctrlKey'>;

export const openInAppWindow = (prefixedPath: string, event?: ModifierEvent): boolean => {
  if (!isElectronApp()) return false;
  if (!event || !(event.metaKey || event.ctrlKey)) return false;

  const opened = window.open(prefixedPath, '_blank');
  if (!opened) {
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'app_window_blocked',
      message: `Failed to open app window for ${prefixedPath}`,
    });
    return false;
  }
  opened.focus();
  return true;
};

export const standaloneNavigate = (
  navigate: NavigateFunction,
  path: string,
  options?: StandaloneNavigateOptions,
): void => {
  const { event, ...navigateOptions } = options || {};
  const normalizedPath = toRegularPath(path);
  const isCmdOrCtrlClick = event && (event.metaKey || event.ctrlKey);

  if (isElectronApp() && isCmdOrCtrlClick && isStandaloneSupportedPath(normalizedPath)) {
    const newWindowPath = toStandalonePath(normalizedPath);
    const newWindow = window.open(newWindowPath, '_blank');
    if (newWindow) {
      newWindow.focus();
    } else {
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('Failed to open new window,PopUp may be blocked'),
      });
    }
    return;
  }

  if (isStandaloneWindow()) {
    void navigate(toStandalonePath(normalizedPath), navigateOptions);
    return;
  }

  void navigate(normalizedPath, navigateOptions);
};

export const shouldOpenInNewWindow = (event?: { metaKey: boolean; ctrlKey: boolean }): boolean =>
  Boolean(event && (event.metaKey || event.ctrlKey) && isElectronApp());

const standaloneWindows = new Map<string, Window>();

const STANDALONE_WINDOW_PREFIX = 'xyne-window:';

let standaloneOpenCount = 0;

const standaloneWindowTarget = (key: string): string => {
  if (!isElectronApp()) {
    return `${STANDALONE_WINDOW_PREFIX}${key}`;
  }
  standaloneOpenCount += 1;
  return `${STANDALONE_WINDOW_PREFIX}${key}#${standaloneOpenCount}`;
};

export const openStandaloneWindow = (path: string, key?: string): boolean => {
  if (typeof window === 'undefined' || !path) {
    return false;
  }

  if (key && !isElectronApp()) {
    const existing = standaloneWindows.get(key);
    if (existing && !existing.closed) {
      existing.focus();
      return true;
    }
    standaloneWindows.delete(key);
  }

  const opened = window.open(toStandalonePath(path), key ? standaloneWindowTarget(key) : '_blank');
  if (!opened) {
    if (key && isElectronApp() && standaloneWindows.has(key)) {
      return true;
    }
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_warn',
      message: String('Failed to open standalone window; popup may be blocked'),
    });
    return false;
  }
  if (key) {
    standaloneWindows.set(key, opened);
  }
  opened.focus();
  return true;
};

export interface CreateTicketPopoutDraft {
  popoutId: string;
  workspaceId?: string | null | undefined;
  channelId: string;
  projectId?: string;
  tab?: string | null | undefined;
  sourceConversationId?: string | null | undefined;
  sourceMessageId?: string | null | undefined;
  entityLinkContext?: { sourceType: 'CANVAS' | 'TRACK'; sourceId: string } | null | undefined;
  initialMessageId?: string | null | undefined;
  parentTicketId?: string | null | undefined;
  isFromSubTicket?: boolean | undefined;
  isFromAI?: boolean | undefined;
  subTickets?: Array<{ title: string; description?: string }> | undefined;
  excludedChatAttachmentIds?: string[] | undefined;
  // Full in-progress form snapshot so nothing the user entered is dropped.
  form: {
    title?: string | undefined;
    description?: string | undefined;
    priority?: string | null | undefined;
    status?: string | undefined;
    assignee?: { type: string; value: string } | null | undefined;
    eta?: string | null | undefined; // ISO
    tags?: string[] | undefined;
    boardId?: string | undefined;
    workflowType?: string | undefined;
    merchantId?: string | undefined;
    ticketType?: string | undefined;
    dynamicFields?: Record<string, string | string[]> | undefined;
  };
}

const POPOUT_DRAFT_PREFIX = 'xyne:createTicketPopout:';

export const openCreateTicketWindow = (draft: CreateTicketPopoutDraft): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  const draftKey = POPOUT_DRAFT_PREFIX + draft.popoutId;
  try {
    localStorage.setItem(draftKey, JSON.stringify(draft));
  } catch {
    // ignore
  }

  const search = new URLSearchParams();
  search.set('popoutId', draft.popoutId);
  if (draft.workspaceId) search.set('workspaceId', draft.workspaceId);
  if (draft.tab) search.set('tab', draft.tab);

  const path = toStandalonePath(`/create-ticket?${search.toString()}`);
  const newWindow = window.open(
    path,
    '_blank',
    isElectronApp() ? '' : 'popup=yes,width=960,height=900',
  );
  if (newWindow) {
    newWindow.focus();
    return true;
  }

  try {
    localStorage.removeItem(draftKey);
  } catch {
    // ignore
  }
  logger.warn(LogEvent.FRONTEND_ERROR, {
    type: 'migrated_console_warn',
    message: String('Failed to open create-ticket window; popup may be blocked'),
  });
  return false;
};

export const consumeCreateTicketDraft = (popoutId: string): CreateTicketPopoutDraft | null => {
  if (typeof window === 'undefined' || !popoutId) {
    return null;
  }
  const draftKey = POPOUT_DRAFT_PREFIX + popoutId;
  try {
    const raw = localStorage.getItem(draftKey);
    if (!raw) {
      return null;
    }
    localStorage.removeItem(draftKey);
    return JSON.parse(raw) as CreateTicketPopoutDraft;
  } catch {
    return null;
  }
};

const POPOUT_TICKET_CHANNEL = 'xyne-create-ticket-popout';

export interface PopOutTicketResult {
  id: string;
  conversationId?: string;
  xyneId?: string;
  workflowType?: string;
}

interface PopOutTicketMessage {
  popoutId: string;
  ticket: PopOutTicketResult;
}

export const postCreateTicketResult = (popoutId: string, ticket: PopOutTicketResult): void => {
  if (typeof BroadcastChannel === 'undefined' || !popoutId) {
    return;
  }
  try {
    const channel = new BroadcastChannel(POPOUT_TICKET_CHANNEL);
    channel.postMessage({ popoutId, ticket } as PopOutTicketMessage);
    channel.close();
  } catch {
    // ignore
  }
};

export const subscribeCreateTicketResult = (
  popoutId: string,
  onResult: (ticket: PopOutTicketResult) => void,
  timeoutMs = 15 * 60 * 1000,
): (() => void) => {
  if (typeof BroadcastChannel === 'undefined' || !popoutId) {
    return () => undefined;
  }

  let channel: BroadcastChannel | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dispose = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (channel) {
      channel.close();
      channel = null;
    }
  };

  try {
    channel = new BroadcastChannel(POPOUT_TICKET_CHANNEL);
    channel.onmessage = (event: MessageEvent<PopOutTicketMessage>): void => {
      if (event.data && event.data.popoutId === popoutId) {
        onResult(event.data.ticket);
        dispose();
      }
    };
    timer = setTimeout(dispose, timeoutMs);
  } catch {
    dispose();
  }

  return dispose;
};

export type CallWindowStage = 'ring' | 'lobby';

export interface OpenCallWindowOptions {
  callId: string;
  callType: string;
  stage: CallWindowStage;
  workspaceId?: string | null | undefined;
  theme?: string | null | undefined;
  inactive?: boolean | undefined;
  extraParams?: URLSearchParams | undefined;
}

const CALL_WINDOW_TARGET = 'xyne-call-window';
const CALL_WINDOW_FEATURES = 'popup=yes,width=960,height=640';
export const CALL_WINDOW_LAUNCH_PARAM = 'launch';

let callWindowLaunchSeq = 0;

export const buildCallWindowPath = (options: OpenCallWindowOptions): string => {
  const search = new URLSearchParams();
  search.set('stage', options.stage);
  callWindowLaunchSeq += 1;
  search.set(CALL_WINDOW_LAUNCH_PARAM, `${Date.now()}-${callWindowLaunchSeq}`);
  if (options.workspaceId) search.set('workspaceId', options.workspaceId);
  if (options.theme) search.set('theme', options.theme);
  options.extraParams?.forEach((value, key) => search.set(key, value));
  return `${CALL_WINDOW_PATH_PREFIX}${encodeURIComponent(options.callId)}/${encodeURIComponent(
    options.callType,
  )}?${search.toString()}`;
};

export const openCallWindow = (options: OpenCallWindowOptions): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  const path = buildCallWindowPath(options);

  if (isElectronApp() && window.electronAPI?.ipcSend) {
    window.electronAPI.ipcSend('call:open-window', {
      relativePath: path,
      inactive: options.inactive === true,
    });
    return true;
  }

  const newWindow = window.open(path, CALL_WINDOW_TARGET, CALL_WINDOW_FEATURES);

  if (newWindow) {
    newWindow.focus();
    return true;
  }

  logger.warn(LogEvent.FRONTEND_ERROR, {
    type: 'migrated_console_warn',
    message: String('Failed to open call window; popup may be blocked'),
  });
  return false;
};

export const focusCallWindow = (): void => {
  if (typeof window === 'undefined') return;
  window.electronAPI?.ipcSend?.('call:focus-window');
};
