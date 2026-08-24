import { CallType } from '@xyne/shared';
import { Event as LogEvent, noopLogger, type Logger } from '@xyne/shared/logger';

let logger: Logger = noopLogger;

export const setReactNativeBridgeLogger = (nextLogger: Logger): void => {
  logger = nextLogger;
};

const BRIDGE_VERSION = 1 as const;
const BRIDGE_CHANNEL = 'xyne-spaces-bridge';
const WEB_SOURCE = 'xyne-dashboard';
const NATIVE_SOURCE = 'xyne-native';

type ImportMetaWithEnv = ImportMeta & {
  env?: Record<string, string | undefined>;
};

const APP_VERSION =
  ((import.meta as ImportMetaWithEnv).env?.['VITE_APP_VERSION'] as string | undefined) ?? 'web';
const hasWindow = typeof window !== 'undefined';

export interface NativeBridgeWindow extends Window {
  ReactNativeWebView?: {
    postMessage: (message: string) => void;
  };
  /**
   * Flag set by React Native to indicate native LiveKit call support.
   * When true, use native LiveKit flow. When false/undefined, use WebView flow.
   */
  nativeCallSupported?: boolean;
}

const getNativeBridge = (): NativeBridgeWindow['ReactNativeWebView'] | null => {
  if (!hasWindow) {
    return null;
  }

  return (window as NativeBridgeWindow).ReactNativeWebView ?? null;
};

/**
 * Returns true when the current window is hosted inside a React Native WebView.
 * This prefers the official bridge but falls back to UA heuristics so the check
 * works even before the native code injects the bridge (e.g. on splash screens).
 */
export const detectReactNativeWebView = (): boolean => {
  if (!hasWindow) {
    return false;
  }

  const bridge = getNativeBridge();
  if (bridge && typeof bridge.postMessage === 'function') {
    return true;
  }

  const userAgent = window.navigator?.userAgent || '';
  const androidWebViewRegex = /\bwv\b|Android.*Version\/[\d.]+/i;
  const iosWebView = /\b(iPhone|iPad|iPod)\b/.test(userAgent) && !/Safari/i.test(userAgent);
  const reactNativeAgent = /ReactNative/i.test(userAgent);

  return reactNativeAgent || androidWebViewRegex.test(userAgent) || iosWebView;
};

/**
 * Returns true when native LiveKit call support is available.
 * This is controlled by the React Native app setting window.nativeCallSupported = true.
 * If not set, falls back to false (WebView-based calls will be used).
 */
export const isNativeCallSupported = (): boolean => {
  if (!hasWindow) {
    return false;
  }

  // Check if the native app has explicitly set the flag
  return (window as NativeBridgeWindow).nativeCallSupported === true;
};

const nativeInboundMessageTypeValues = {
  GOOGLE_SIGN_IN_RESULT: 'GOOGLE_SIGN_IN_RESULT',
  MICROSOFT_SIGN_IN_RESULT: 'MICROSOFT_SIGN_IN_RESULT',
  NATIVE_READY: 'NATIVE_READY',
  NATIVE_SIGN_OUT: 'NATIVE_SIGN_OUT',
  NATIVE_PUSH_TOKEN: 'NATIVE_PUSH_TOKEN',
  NATIVE_PUSH_MESSAGE: 'NATIVE_PUSH_MESSAGE',
  NATIVE_NOTIFICATION_PERMISSION: 'NATIVE_NOTIFICATION_PERMISSION',
  NATIVE_FILE_SAVE_RESULT: 'NATIVE_FILE_SAVE_RESULT',
  // LiveKit native bridge events
  LIVEKIT_CONNECTION_STATE: 'LIVEKIT_CONNECTION_STATE',
  LIVEKIT_PARTICIPANTS_CHANGED: 'LIVEKIT_PARTICIPANTS_CHANGED',
  LIVEKIT_ERROR: 'LIVEKIT_ERROR',
  LIVEKIT_TRACK_SUBSCRIBED: 'LIVEKIT_TRACK_SUBSCRIBED',
  LIVEKIT_TRACK_UNSUBSCRIBED: 'LIVEKIT_TRACK_UNSUBSCRIBED',
  LIVEKIT_CALL_ENDED: 'LIVEKIT_CALL_ENDED',
  // Native call joined from notification (for Zero DB sync)
  NATIVE_CALL_JOINED: 'NATIVE_CALL_JOINED',
  // Pending call state for cold start sync
  NATIVE_PENDING_CALL_STATE: 'NATIVE_PENDING_CALL_STATE',
  // Call actions
  NATIVE_REQUEST_CALLBACK: 'NATIVE_REQUEST_CALLBACK',
  CLOSE_DRAWER: 'CLOSE_DRAWER',
  GET_CLIENT_SESSION_ID: 'GET_CLIENT_SESSION_ID',
  // Keyboard events
  KEYBOARD_OPEN: 'KEYBOARD_OPEN',
  KEYBOARD_HIDDEN: 'KEYBOARD_HIDDEN',
  // Share recording from native RecordingDetailScreen
  SHARE_RECORDING: 'SHARE_RECORDING',
  // Call from Phone app Recents
  START_CALL_FROM_RECENTS: 'START_CALL_FROM_RECENTS',
  // App lifecycle events
  NATIVE_APP_FOREGROUND: 'NATIVE_APP_FOREGROUND',
} as const;

export type NativeInboundMessageType = keyof typeof nativeInboundMessageTypeValues;
export const NativeInboundMessageType = nativeInboundMessageTypeValues;

const nativeOutboundMessageTypeValues = {
  WEB_APP_READY: 'WEB_APP_READY',
  WEB_ROUTE_READY: 'WEB_ROUTE_READY',
  REQUEST_GOOGLE_SIGN_IN: 'REQUEST_GOOGLE_SIGN_IN',
  REQUEST_MICROSOFT_SIGN_IN: 'REQUEST_MICROSOFT_SIGN_IN',
  WEB_SIGN_OUT: 'WEB_SIGN_OUT',
  AUTH_STATE_SYNC: 'AUTH_STATE_SYNC',
  REQUEST_MEDIA_PERMISSIONS: 'REQUEST_MEDIA_PERMISSIONS',
  REQUEST_NATIVE_PUSH_TOKEN: 'REQUEST_NATIVE_PUSH_TOKEN',
  SAVE_FILE_TO_DEVICE: 'SAVE_FILE_TO_DEVICE',
  // LiveKit native bridge commands
  CALL_INITIATING: 'CALL_INITIATING',
  CALL_FAILED: 'CALL_FAILED',
  LIVEKIT_CONNECT: 'LIVEKIT_CONNECT',
  LIVEKIT_DISCONNECT: 'LIVEKIT_DISCONNECT',
  LIVEKIT_TOGGLE_MIC: 'LIVEKIT_TOGGLE_MIC',
  LIVEKIT_TOGGLE_CAMERA: 'LIVEKIT_TOGGLE_CAMERA',
  LIVEKIT_TOGGLE_SCREEN_SHARE: 'LIVEKIT_TOGGLE_SCREEN_SHARE',
  START_NOTE_TAKER: 'START_NOTE_TAKER',
  DRAWER_OPENED: 'DRAWER_OPENED',
  DRAWER_CLOSED: 'DRAWER_CLOSED',
  REQUEST_CLIENT_SESSION_ID: 'REQUEST_CLIENT_SESSION_ID',
  RESTORE_RECORDING_SCREEN: 'RESTORE_RECORDING_SCREEN',
  CLEAR_RECORDING_STATE: 'CLEAR_RECORDING_STATE',
  REQUEST_NATIVE_SHELL: 'REQUEST_NATIVE_SHELL',
  OPEN_EXTERNAL_URL: 'OPEN_EXTERNAL_URL',
} as const;

export type NativeOutboundMessageType = keyof typeof nativeOutboundMessageTypeValues;
export const NativeOutboundMessageType = nativeOutboundMessageTypeValues;

export interface BridgeEnvelope<T extends string, P = Record<string, unknown> | undefined> {
  version: number;
  channel: string;
  source: string;
  type: T;
  timestamp: number;
  payload?: P;
}

export interface NativeReadyPayload {
  platform?: 'ios' | 'android';
  version?: string;
}

export interface NativeSignOutPayload {
  reason?: string;
}

export interface NativePushTokenPayload {
  token: string;
  voipToken?: string;
  platform?: 'ios' | 'android' | 'unknown';
  deviceId?: string;
  sessionId?: string | null;
}

export interface NativePushMessagePayload {
  context?: string;
  messageId?: string | null;
  title?: string | null;
  body?: string | null;
  deepLink?: string | null;
  data?: Record<string, string>;
}

export interface NativeNotificationPermissionPayload {
  granted?: boolean;
}

export interface NativeGoogleSignInResultPayload {
  success: boolean;
  sessionId?: string | null;
  userId?: string;
  workspaceId?: string;
  role?: string;
  orgRole?: string;
  memberId?: string;
  hasRefreshToken?: boolean;
  error?: string;
  errorMessage?: string;
  workspaces?: { id: string; name: string; role: string }[];
  email?: string;
  name?: string;
  picture?: string;
  userExistsButRemoved?: boolean;
}

export interface NativeMicrosoftSignInResultPayload {
  success: boolean;
  sessionId?: string | null;
  userId?: string;
  email?: string;
  name?: string;
  error?: string;
  errorMessage?: string;
  workspaces?: { id: string; name: string; role: string }[];
  picture?: string;
  userExistsButRemoved?: boolean;
}

export interface NativeFileSaveResultPayload {
  success: boolean;
  errorMessage?: string;
}

export interface SaveFilePayload {
  fileName: string;
  mimeType?: string;
  base64Data: string;
}
// LiveKit native bridge payload types
export interface LiveKitConnectPayload {
  token: string;
  serverUrl: string;
  callType: CallType;
  externalId: string;
  roomLink?: string;
  callerName?: string;
  roomName?: string;
  channelId?: string;
  conversationId?: string;
  scopeType?: string | null; // Channel scope type for CallKit filtering
}

export interface LiveKitTogglePayload {
  enabled: boolean;
}

export interface LiveKitConnectionStatePayload {
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
}

export interface LiveKitParticipantPayload {
  identity: string;
  name?: string;
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  isScreenShareEnabled: boolean;
  isLocal: boolean;
}

export interface LiveKitParticipantsChangedPayload {
  participants: LiveKitParticipantPayload[];
}

export interface LiveKitErrorPayload {
  error: string;
}

export interface LiveKitTrackEventPayload {
  participantIdentity: string;
  trackSid: string;
  trackType: 'audio' | 'video' | 'screen';
}

// Payload for native-initiated call end events (allows web to perform cleanup)
export interface LiveKitCallEndedPayload {
  callId: string;
  callType: CallType;
  durationMs: number;
  initiatedBy: 'user' | 'callkit' | 'error';
}

// Payload for native call joined from notification (for Zero DB sync)
export interface NativeCallJoinedPayload {
  callId: string;
  channelId: string;
  callType: CallType;
}

// Payload for pending call state (cold start sync)
export interface NativePendingCallStatePayload {
  activeCallId?: string;
  endedCallId?: string;
}

export interface NativeRequestCallbackPayload {
  channelId?: string;
  userId?: string;
  roomName?: string;
  callType?: CallType;
}

export interface GetClientSessionIdPayload {
  sessionId: string;
}

type ReactNativeInboundPayloadMap = {
  GOOGLE_SIGN_IN_RESULT: NativeGoogleSignInResultPayload;
  MICROSOFT_SIGN_IN_RESULT: NativeMicrosoftSignInResultPayload;
  NATIVE_READY: NativeReadyPayload;
  NATIVE_SIGN_OUT: NativeSignOutPayload;
  NATIVE_PUSH_TOKEN: NativePushTokenPayload;
  NATIVE_PUSH_MESSAGE: NativePushMessagePayload;
  NATIVE_NOTIFICATION_PERMISSION: NativeNotificationPermissionPayload;
  NATIVE_FILE_SAVE_RESULT: NativeFileSaveResultPayload;
  // LiveKit native bridge events
  LIVEKIT_CONNECTION_STATE: LiveKitConnectionStatePayload;
  LIVEKIT_PARTICIPANTS_CHANGED: LiveKitParticipantsChangedPayload;
  LIVEKIT_ERROR: LiveKitErrorPayload;
  LIVEKIT_TRACK_SUBSCRIBED: LiveKitTrackEventPayload;
  LIVEKIT_TRACK_UNSUBSCRIBED: LiveKitTrackEventPayload;
  LIVEKIT_CALL_ENDED: LiveKitCallEndedPayload;
  // Native call joined from notification
  NATIVE_CALL_JOINED: NativeCallJoinedPayload;
  // Pending call state for cold start sync
  NATIVE_PENDING_CALL_STATE: NativePendingCallStatePayload;
  NATIVE_REQUEST_CALLBACK: NativeRequestCallbackPayload;
  GET_CLIENT_SESSION_ID: GetClientSessionIdPayload;
  CLOSE_DRAWER: undefined;
  // Keyboard events
  KEYBOARD_OPEN: undefined;
  KEYBOARD_HIDDEN: undefined;
  // Share recording from native RecordingDetailScreen
  SHARE_RECORDING: { messageId: string };
  // Call from Phone app Recents
  START_CALL_FROM_RECENTS: {
    channelId: string;
    callType?: CallType;
    source?: string;
  };
  // App lifecycle events
  NATIVE_APP_FOREGROUND: undefined;
};
type ReactNativeOutboundPayloadMap = {
  WEB_APP_READY: {
    path: string;
    version: string;
  };
  WEB_ROUTE_READY: {
    path: string;
  };
  REQUEST_GOOGLE_SIGN_IN: {
    reason?: string;
  };
  REQUEST_MICROSOFT_SIGN_IN: {
    reason?: string;
  };
  WEB_SIGN_OUT: {
    reason?: string;
  };
  AUTH_STATE_SYNC: {
    isAuthenticated: boolean;
    user?: {
      id: string;
      email: string | null;
    } | null;
  };
  REQUEST_NATIVE_SHELL: {
    reason?: string;
  };
  REQUEST_MEDIA_PERMISSIONS: {
    permissions: ('microphone' | 'camera' | 'screenShare')[];
  };
  REQUEST_NATIVE_PUSH_TOKEN: undefined;
  REQUEST_CLIENT_SESSION_ID: undefined;
  SAVE_FILE_TO_DEVICE: SaveFilePayload;
  // LiveKit native bridge commands
  CALL_INITIATING: {
    channelId?: string;
    scopeType?: string | null; // Channel scope type for CallKit filtering (DM, GROUP_DM, DEFAULT, etc.)
    callType?: CallType;
  };
  CALL_FAILED: {
    error?: string;
  };
  LIVEKIT_CONNECT: LiveKitConnectPayload;
  LIVEKIT_DISCONNECT: undefined;
  LIVEKIT_TOGGLE_MIC: LiveKitTogglePayload;
  LIVEKIT_TOGGLE_CAMERA: LiveKitTogglePayload;
  LIVEKIT_TOGGLE_SCREEN_SHARE: LiveKitTogglePayload;
  START_NOTE_TAKER: undefined;
  DRAWER_OPENED: undefined;
  DRAWER_CLOSED: undefined;
  RESTORE_RECORDING_SCREEN: undefined;
  CLEAR_RECORDING_STATE: undefined;
  OPEN_EXTERNAL_URL: { url: string };
};

export type ReactNativeInboundMessage = {
  [K in NativeInboundMessageType]: BridgeEnvelope<K, ReactNativeInboundPayloadMap[K]>;
}[NativeInboundMessageType];

export type ReactNativeOutboundMessage = {
  [K in NativeOutboundMessageType]: BridgeEnvelope<K, ReactNativeOutboundPayloadMap[K]>;
}[NativeOutboundMessageType];

type BridgeListener<T extends NativeInboundMessageType> = (
  message: Extract<ReactNativeInboundMessage, { type: T }>,
) => void;

const safeParse = (data: unknown): Record<string, unknown> | null => {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  if (typeof data === 'object' && data !== null) {
    return data as Record<string, unknown>;
  }

  return null;
};

class ReactNativeBridge {
  private initialized = false;
  private listeners = new Map<
    NativeInboundMessageType,
    Set<(message: ReactNativeInboundMessage) => void>
  >();
  private nativeReady = false;
  private nativeNotificationPermission: NativeNotificationPermissionPayload | null = null;
  // Queue for messages that arrive before listeners subscribe (critical for cold start)
  private pendingMessages = new Map<NativeInboundMessageType, ReactNativeInboundMessage>();
  // Message types that should be queued for late listeners
  private readonly queueableMessageTypes: Set<NativeInboundMessageType> =
    new Set<NativeInboundMessageType>([
      'NATIVE_PENDING_CALL_STATE',
      'NATIVE_CALL_JOINED',
      'NATIVE_REQUEST_CALLBACK',
      'START_CALL_FROM_RECENTS', // Queued for cold start safety (Recents tap before NotificationHandler ready)
    ]);
  // Messages arrive from the React Native host via WebView injection, which carries no web
  // origin, so same-origin is the strongest check available here. parseInboundMessage validates
  // the shape and type of every message before it is dispatched.
  private readonly messageHandler = (event: MessageEvent): void => {
    // React-Native-injected messages arrive with an empty origin or the app's own origin;
    // reject cross-origin postMessages.
    if (event.origin && event.origin !== window.location.origin) {
      return;
    }
    const message = this.parseInboundMessage(event.data);
    if (!message) {
      return;
    }

    logger.info(LogEvent.INFO, {
      type: 'migrated_console_info',
      message: String('[RN Bridge] <='),
      context: [message.type, message.payload ?? null],
    });

    if (message.type === NativeInboundMessageType.NATIVE_READY) {
      this.nativeReady = true;
    }

    if (message.type === NativeInboundMessageType.NATIVE_NOTIFICATION_PERMISSION) {
      this.nativeNotificationPermission = message.payload ?? null;
    }

    this.dispatch(message);
  };

  initialize(): void {
    if (this.initialized || !hasWindow) {
      return;
    }

    window.addEventListener('message', this.messageHandler);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('message', this.messageHandler as EventListener);
    }

    this.initialized = true;
    this.send(NativeOutboundMessageType.WEB_APP_READY, {
      path: window.location?.pathname ?? '/',
      version: APP_VERSION,
    });
  }

  dispose(): void {
    if (!this.initialized || !hasWindow) {
      return;
    }

    window.removeEventListener('message', this.messageHandler);
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('message', this.messageHandler as EventListener);
    }

    this.listeners.clear();
    this.initialized = false;
    this.nativeReady = false;
    this.nativeNotificationPermission = null;
  }

  isAvailable(): boolean {
    return detectReactNativeWebView() && !!getNativeBridge();
  }

  isNativeReady(): boolean {
    return this.nativeReady;
  }

  getNotificationPermissionStatus(): NativeNotificationPermissionPayload | null {
    return this.nativeNotificationPermission;
  }

  /**
   * Sends a raw typed message to the native container.
   */
  send<T extends NativeOutboundMessageType>(
    type: T,
    payload?: ReactNativeOutboundPayloadMap[T],
  ): boolean {
    const bridge = getNativeBridge();
    if (!bridge) {
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('[RN Bridge] => FAILED - bridge not available'),
        context: [type],
      });
      return false;
    }

    const envelope: BridgeEnvelope<T, ReactNativeOutboundPayloadMap[T]> = {
      channel: BRIDGE_CHANNEL,
      source: WEB_SOURCE,
      type,
      version: BRIDGE_VERSION,
      timestamp: Date.now(),
      ...(payload === undefined ? {} : { payload }),
    };

    try {
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String('[RN Bridge] =>'),
        context: [type, payload ?? null],
      });
      bridge.postMessage(JSON.stringify(envelope));
      return true;
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[RN Bridge] Failed to post message to native layer:'),
        error: error,
      });
      return false;
    }
  }

  requestGoogleSignIn(
    payload?: ReactNativeOutboundPayloadMap[typeof NativeOutboundMessageType.REQUEST_GOOGLE_SIGN_IN],
  ): boolean {
    return this.send(NativeOutboundMessageType.REQUEST_GOOGLE_SIGN_IN, payload);
  }

  requestMicrosoftSignIn(
    payload?: ReactNativeOutboundPayloadMap[typeof NativeOutboundMessageType.REQUEST_MICROSOFT_SIGN_IN],
  ): boolean {
    return this.send(NativeOutboundMessageType.REQUEST_MICROSOFT_SIGN_IN, payload);
  }

  syncAuthState(
    payload: ReactNativeOutboundPayloadMap[typeof NativeOutboundMessageType.AUTH_STATE_SYNC],
  ): boolean {
    return this.send(NativeOutboundMessageType.AUTH_STATE_SYNC, payload);
  }

  notifySignOut(reason?: string): boolean {
    return this.send(
      NativeOutboundMessageType.WEB_SIGN_OUT,
      reason === undefined ? undefined : { reason },
    );
  }

  requestMediaPermissions(
    payload: ReactNativeOutboundPayloadMap[typeof NativeOutboundMessageType.REQUEST_MEDIA_PERMISSIONS],
  ): boolean {
    return this.send(NativeOutboundMessageType.REQUEST_MEDIA_PERMISSIONS, payload);
  }

  requestNativePushToken(): boolean {
    return this.send(NativeOutboundMessageType.REQUEST_NATIVE_PUSH_TOKEN);
  }

  requestNativeShell(reason?: string): boolean {
    return this.send(
      NativeOutboundMessageType.REQUEST_NATIVE_SHELL,
      reason === undefined ? undefined : { reason },
    );
  }

  openExternalUrl(url: string): boolean {
    return this.send(NativeOutboundMessageType.OPEN_EXTERNAL_URL, { url });
  }

  saveFileToDevice(
    payload: ReactNativeOutboundPayloadMap[typeof NativeOutboundMessageType.SAVE_FILE_TO_DEVICE],
  ): boolean {
    return this.send(NativeOutboundMessageType.SAVE_FILE_TO_DEVICE, payload);
  }

  notifyRouteReady(path: string): boolean {
    return this.send(NativeOutboundMessageType.WEB_ROUTE_READY, { path });
  }
  // LiveKit native bridge methods
  livekitConnect(payload: LiveKitConnectPayload): boolean {
    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String('[RN Bridge] Sending LIVEKIT_CONNECT'),
      context: [
        {
          serverUrl: payload.serverUrl,
          callType: payload.callType,
          externalId: payload.externalId,
          callerName: payload.callerName,
          roomName: payload.roomName,
        },
      ],
    });
    return this.send(NativeOutboundMessageType.LIVEKIT_CONNECT, payload);
  }

  livekitDisconnect(): boolean {
    logger.info(LogEvent.INFO, {
      type: 'migrated_console_log',
      message: String('[ReactNativeBridge] livekitDisconnect called'),
      context: [new Error().stack],
    });
    return this.send(NativeOutboundMessageType.LIVEKIT_DISCONNECT);
  }

  livekitToggleMic(enabled: boolean): boolean {
    return this.send(NativeOutboundMessageType.LIVEKIT_TOGGLE_MIC, { enabled });
  }

  livekitToggleCamera(enabled: boolean): boolean {
    return this.send(NativeOutboundMessageType.LIVEKIT_TOGGLE_CAMERA, { enabled });
  }

  livekitToggleScreenShare(enabled: boolean): boolean {
    return this.send(NativeOutboundMessageType.LIVEKIT_TOGGLE_SCREEN_SHARE, { enabled });
  }

  startNoteTaker(): boolean {
    return this.send(NativeOutboundMessageType.START_NOTE_TAKER);
  }

  getClientSessionId(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isAvailable()) {
        reject(new Error('React Native bridge not available'));
        return;
      }

      // Set up one-time listener for response
      const unsubscribe = this.on(NativeInboundMessageType.GET_CLIENT_SESSION_ID, message => {
        unsubscribe();
        const sessionId = message.payload?.sessionId;
        if (sessionId) {
          resolve(sessionId);
        } else {
          reject(new Error('No clientSessionId in response'));
        }
      });

      // Send request
      this.send(NativeOutboundMessageType.REQUEST_CLIENT_SESSION_ID);

      // Timeout after 5 seconds
      setTimeout(() => {
        unsubscribe();
        reject(new Error('Timeout waiting for client session ID'));
      }, 5000);
    });
  }

  on<T extends NativeInboundMessageType>(type: T, handler: BridgeListener<T>): () => void {
    const scopedHandler = handler as unknown as (message: ReactNativeInboundMessage) => void;
    const currentListeners = this.listeners.get(type) ?? new Set();
    currentListeners.add(scopedHandler);
    this.listeners.set(type, currentListeners);

    if (!this.initialized) {
      this.initialize();
    }

    // Replay any pending messages for this type (handles cold start race condition)
    const pendingMessage = this.pendingMessages.get(type);
    if (pendingMessage) {
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String('[RN Bridge] Replaying pending message for late listener:'),
        context: [type, pendingMessage.payload],
      });
      this.pendingMessages.delete(type);
      // Dispatch asynchronously to avoid issues with handler setup
      setTimeout(() => {
        try {
          scopedHandler(pendingMessage);
        } catch (error) {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[RN Bridge] Failed to replay pending message:'),
            error: error,
          });
        }
      }, 0);
    }

    return () => {
      const listeners = this.listeners.get(type);
      if (!listeners) {
        return;
      }
      listeners.delete(scopedHandler);
      if (listeners.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  private dispatch(message: ReactNativeInboundMessage): void {
    const listeners = this.listeners.get(message.type);
    if (!listeners || listeners.size === 0) {
      // Queue the message for late listeners if it's a queueable type
      if (this.queueableMessageTypes.has(message.type)) {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('[RN Bridge] Queuing message for late listener:'),
          context: [message.type, message.payload],
        });
        this.pendingMessages.set(message.type, message);
      }
      return;
    }

    listeners.forEach(listener => {
      try {
        listener(message);
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[RN Bridge] Listener execution failed:'),
          error: error,
        });
      }
    });
  }

  private parseInboundMessage(raw: unknown): ReactNativeInboundMessage | null {
    const data = safeParse(raw);
    if (!data) {
      return null;
    }

    const channel = data['channel'];
    if (typeof channel === 'string' && channel !== BRIDGE_CHANNEL) {
      return null;
    }

    const source = data['source'];
    if (typeof source === 'string' && source !== NATIVE_SOURCE) {
      return null;
    }

    const typeValue = data['type'];
    if (typeof typeValue !== 'string' || !(typeValue in NativeInboundMessageType)) {
      return null;
    }
    const type = typeValue as NativeInboundMessageType;

    const payloadRaw = data['payload'];
    const payload = (payloadRaw ?? {}) as ReactNativeInboundPayloadMap[NativeInboundMessageType];
    const timestampValue = data['timestamp'];
    const timestamp = typeof timestampValue === 'number' ? timestampValue : Date.now();
    const versionValue = data['version'];
    const version = typeof versionValue === 'number' ? versionValue : BRIDGE_VERSION;

    return {
      channel: BRIDGE_CHANNEL,
      source: NATIVE_SOURCE,
      version,
      timestamp,
      type,
      payload,
    } as ReactNativeInboundMessage;
  }
}

export const reactNativeBridge = new ReactNativeBridge();
