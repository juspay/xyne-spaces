import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
  type AppStateStatus,
  type EventSubscription,
  type NativeEventSubscription,
} from 'react-native';

import { logger, type EventType } from './logger';
import { isProtectedSecureWebSocketHost } from './mtlsTransportPolicy';

type SocketEvent = {
  type: 'open' | 'message' | 'close' | 'error';
  data?: string;
  code?: number;
  reason?: string;
  wasClean?: boolean;
  message?: string;
};

type SocketListener = (event: SocketEvent) => void;

/** Must match native MtlsSocketModule.connect(url, protocols, headers, promise). */
interface MtlsSocketModuleInterface {
  connect(
    url: string,
    protocols: string[],
    headers: Record<string, string> | null,
  ): Promise<number>;
  send(socketId: number, data: string): Promise<boolean>;
  close(socketId: number, code?: number, reason?: string): Promise<boolean>;
}

interface NativeSocketEvent extends SocketEvent {
  socketId: number;
}

const MtlsSocketModule = NativeModules['MtlsSocketModule'] as MtlsSocketModuleInterface | undefined;
const ORIGINAL_WEBSOCKET = globalThis.WebSocket;
const EVENT_NAME = 'mtlsWebSocketEvent';
const MTLS_WS_LOG = '[Presence][MtlsWebSocket]';
const MTLS_IOS_SOCKET_EVENT = 'lotus_ios_mtls_socket' as EventType;

let interceptorInstalled = false;
let nativeEventSubscription: EventSubscription | null = null;
let appStateSubscription: NativeEventSubscription | null = null;
let nextDiagnosticSocketId = 1;

type DiagnosticLevel = 'info' | 'warn' | 'error';

function isIosDiagnosticsEnabled(): boolean {
  return Platform.OS === 'ios';
}

function getHostForDiagnostics(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

function logIosMtlsSocketDiagnostic(
  level: DiagnosticLevel,
  phase: string,
  data: Record<string, unknown> = {},
  options: { flush?: boolean } = {},
): void {
  if (!isIosDiagnosticsEnabled()) {
    return;
  }

  const payload = {
    diagnostic: 'ios_mtls_socket',
    phase,
    activeSocketCount: NativeMtlsWebSocketRegistry.sockets.size,
    ...data,
  };

  logger.addBreadcrumb(
    level === 'error' ? 'error' : 'state_change',
    `iOS mTLS socket: ${phase}`,
    payload,
  );
  logger[level](MTLS_IOS_SOCKET_EVENT, payload);

  if (options.flush) {
    void logger.flushLogs();
  }
}

function normalizeProtocols(protocols?: string | string[]): string[] {
  if (protocols === undefined) {
    return [];
  }
  return Array.isArray(protocols) ? protocols : [protocols];
}

function normalizeHeaders(headers?: Record<string, string>): Record<string, string> | null {
  if (!headers) {
    return null;
  }
  const entries = Object.entries(headers).filter(
    ([key, value]) => key.length > 0 && value.trim().length > 0,
  );
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(entries);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNativeSocketNotFoundError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('socket') && message.includes('not found');
}

function connectNativeSocket(
  url: string,
  protocols: string[],
  headers?: Record<string, string>,
): Promise<number> {
  if (!MtlsSocketModule) {
    throw new Error('MtlsSocketModule is not available. Rebuild the native app.');
  }

  const headerPayload = normalizeHeaders(headers);
  const host = getHostForDiagnostics(url);
  console.log(MTLS_WS_LOG, 'native connect', {
    host,
    protocolCount: protocols.length,
    headerKeys: headerPayload ? Object.keys(headerPayload) : [],
  });

  return MtlsSocketModule.connect(url, protocols, headerPayload);
}

class NativeMtlsWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readonly protocol: string;
  readonly extensions = '';
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  readyState = NativeMtlsWebSocket.CONNECTING;
  onopen: SocketListener | null = null;
  onmessage: SocketListener | null = null;
  onclose: SocketListener | null = null;
  onerror: SocketListener | null = null;

  private readonly listeners = {
    open: new Set<SocketListener>(),
    message: new Set<SocketListener>(),
    close: new Set<SocketListener>(),
    error: new Set<SocketListener>(),
  };
  private socketId: number | null = null;
  private readonly diagnosticSocketId = nextDiagnosticSocketId++;
  private readonly diagnosticHost: string;

  constructor(url: string, protocols?: string | string[], headers?: Record<string, string>) {
    if (!MtlsSocketModule) {
      throw new Error('MtlsSocketModule is not available. Rebuild the native app.');
    }

    this.url = url;
    this.diagnosticHost = getHostForDiagnostics(url);
    const normalizedProtocols = normalizeProtocols(protocols);
    this.protocol = normalizedProtocols[0] ?? '';

    void connectNativeSocket(url, normalizedProtocols, headers)
      .then(socketId => {
        console.log(MTLS_WS_LOG, 'native connect resolved', { socketId });
        this.socketId = socketId;
        NativeMtlsWebSocketRegistry.register(socketId, this);

        if (this.readyState === NativeMtlsWebSocket.CLOSING) {
          logIosMtlsSocketDiagnostic('warn', 'close_before_open', {
            diagnosticSocketId: this.diagnosticSocketId,
            socketId,
            host: this.diagnosticHost,
          });
          void MtlsSocketModule.close(socketId, 1000, 'Closed before socket opened');
        }
      })
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(MTLS_WS_LOG, 'native connect failed', { message });
        logIosMtlsSocketDiagnostic(
          'error',
          'connect_failed',
          {
            diagnosticSocketId: this.diagnosticSocketId,
            host: this.diagnosticHost,
            message,
          },
          { flush: true },
        );
        this.dispatchNativeEvent({ type: 'error', message });
        this.dispatchNativeEvent({
          type: 'close',
          code: 1006,
          reason: message,
          wasClean: false,
        });
      });
  }

  send(data: string): void {
    if (this.socketId === null || this.readyState !== NativeMtlsWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }

    void MtlsSocketModule?.send(this.socketId, data)
      .then(sent => {
        if (sent === false && this.readyState !== NativeMtlsWebSocket.CLOSED) {
          this.dispatchNativeEvent({
            type: 'close',
            code: 1006,
            reason: 'Native socket was already closed',
            wasClean: false,
          });
        }
      })
      .catch(error => {
        const message = getErrorMessage(error);
        if (isNativeSocketNotFoundError(error)) {
          logIosMtlsSocketDiagnostic(
            'warn',
            'send_stale_socket',
            {
              diagnosticSocketId: this.diagnosticSocketId,
              socketId: this.socketId,
              host: this.diagnosticHost,
              message,
            },
            { flush: true },
          );
          if (this.readyState !== NativeMtlsWebSocket.CLOSED) {
            this.dispatchNativeEvent({
              type: 'close',
              code: 1006,
              reason: message,
              wasClean: false,
            });
          }
          return;
        }
        logIosMtlsSocketDiagnostic(
          'error',
          'send_failed',
          {
            diagnosticSocketId: this.diagnosticSocketId,
            socketId: this.socketId,
            host: this.diagnosticHost,
            message,
          },
          { flush: true },
        );
      });
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === NativeMtlsWebSocket.CLOSED) {
      return;
    }

    this.readyState = NativeMtlsWebSocket.CLOSING;

    if (this.socketId !== null) {
      void MtlsSocketModule?.close(this.socketId, code, reason).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        logIosMtlsSocketDiagnostic(
          'error',
          'close_failed',
          {
            diagnosticSocketId: this.diagnosticSocketId,
            socketId: this.socketId,
            host: this.diagnosticHost,
            message,
          },
          { flush: true },
        );
      });
    }
  }

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: SocketListener): void {
    this.listeners[type].add(listener);
  }

  removeEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: SocketListener,
  ): void {
    this.listeners[type].delete(listener);
  }

  dispatchNativeEvent(event: SocketEvent): void {
    if (event.type === 'open' || event.type === 'close' || event.type === 'error') {
      console.log(MTLS_WS_LOG, 'event', {
        type: event.type,
        code: event.code,
        reason: event.reason ?? event.message,
      });
    }

    if (event.type === 'open') {
      this.readyState = NativeMtlsWebSocket.OPEN;
    } else if (event.type === 'close') {
      this.readyState = NativeMtlsWebSocket.CLOSED;
      if (this.socketId !== null) {
        NativeMtlsWebSocketRegistry.unregister(this.socketId);
      }
      if (event.wasClean === false || event.code === 1006) {
        logIosMtlsSocketDiagnostic(
          'warn',
          'native_unclean_close',
          {
            diagnosticSocketId: this.diagnosticSocketId,
            socketId: this.socketId,
            host: this.diagnosticHost,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          },
          { flush: true },
        );
      }
    } else if (event.type === 'error') {
      logIosMtlsSocketDiagnostic(
        'error',
        'native_error',
        {
          diagnosticSocketId: this.diagnosticSocketId,
          socketId: this.socketId,
          host: this.diagnosticHost,
          message: event.message,
        },
        { flush: true },
      );
    }

    const handler =
      event.type === 'open'
        ? this.onopen
        : event.type === 'message'
          ? this.onmessage
          : event.type === 'close'
            ? this.onclose
            : this.onerror;

    handler?.(event);
    for (const listener of this.listeners[event.type]) {
      listener(event);
    }
  }
}

const NativeMtlsWebSocketRegistry = {
  sockets: new Map<number, NativeMtlsWebSocket>(),
  register(socketId: number, socket: NativeMtlsWebSocket): void {
    this.sockets.set(socketId, socket);
  },
  unregister(socketId: number): void {
    this.sockets.delete(socketId);
  },
  dispatch(event: NativeSocketEvent): void {
    const socket = this.sockets.get(event.socketId);
    if (!socket) {
      logIosMtlsSocketDiagnostic(
        event.type === 'error' || event.type === 'close' ? 'warn' : 'info',
        'native_event_without_js_socket',
        {
          socketId: event.socketId,
          eventType: event.type,
          code: event.code,
          reason: event.reason ?? event.message,
        },
        { flush: event.type === 'error' || event.type === 'close' },
      );
      return;
    }
    socket.dispatchNativeEvent(event);
  },
};

function handleMtlsSocketAppStateChange(nextAppState: AppStateStatus): void {
  if (!isIosDiagnosticsEnabled()) {
    return;
  }

  if (nextAppState === 'background') {
    logIosMtlsSocketDiagnostic(
      'info',
      'app_background',
      {
        socketIds: Array.from(NativeMtlsWebSocketRegistry.sockets.keys()),
      },
      { flush: true },
    );
  }
}

type WebSocketCtor = new (
  url: string | URL,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

export function installMtlsWebSocketInterceptor(): void {
  if (
    interceptorInstalled ||
    (Platform.OS !== 'android' && Platform.OS !== 'ios') ||
    !MtlsSocketModule ||
    typeof ORIGINAL_WEBSOCKET !== 'function'
  ) {
    return;
  }

  const emitter = new NativeEventEmitter(NativeModules['MtlsSocketModule']);
  nativeEventSubscription = emitter.addListener(EVENT_NAME, payload => {
    NativeMtlsWebSocketRegistry.dispatch(payload as NativeSocketEvent);
  });
  if (Platform.OS === 'ios') {
    appStateSubscription = AppState.addEventListener('change', handleMtlsSocketAppStateChange);
  }

  const InterceptedWebSocket = function (
    this: unknown,
    url: string | URL,
    protocols?: string | string[],
    options?: { headers?: Record<string, string> },
  ) {
    const urlString = typeof url === 'string' ? url : url.toString();
    if (isProtectedSecureWebSocketHost(urlString)) {
      return new NativeMtlsWebSocket(
        urlString,
        protocols,
        options?.headers,
      ) as unknown as WebSocket;
    }
    const FallbackWebSocket = ORIGINAL_WEBSOCKET as unknown as WebSocketCtor;
    return new FallbackWebSocket(urlString, protocols, options);
  } as unknown as WebSocketCtor & {
    CONNECTING: number;
    OPEN: number;
    CLOSING: number;
    CLOSED: number;
  };

  InterceptedWebSocket.CONNECTING = ORIGINAL_WEBSOCKET.CONNECTING;
  InterceptedWebSocket.OPEN = ORIGINAL_WEBSOCKET.OPEN;
  InterceptedWebSocket.CLOSING = ORIGINAL_WEBSOCKET.CLOSING;
  InterceptedWebSocket.CLOSED = ORIGINAL_WEBSOCKET.CLOSED;
  InterceptedWebSocket.prototype = ORIGINAL_WEBSOCKET.prototype;

  globalThis.WebSocket = InterceptedWebSocket as unknown as typeof WebSocket;
  interceptorInstalled = true;
  console.log(MTLS_WS_LOG, 'interceptor installed', { platform: Platform.OS });
}

export function removeMtlsWebSocketInterceptor(): void {
  if (!interceptorInstalled) {
    return;
  }

  nativeEventSubscription?.remove();
  nativeEventSubscription = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  globalThis.WebSocket = ORIGINAL_WEBSOCKET;
  interceptorInstalled = false;
}
