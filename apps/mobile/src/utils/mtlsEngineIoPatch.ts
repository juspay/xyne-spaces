import { Platform } from 'react-native';
import { WebSocket as EngineIoWebSocketTransport } from 'engine.io-client';

let engineIoWebSocketPatched = false;

const isReactNative =
  typeof navigator !== 'undefined' &&
  typeof navigator.product === 'string' &&
  navigator.product.toLowerCase() === 'reactnative';

/**
 * engine.io-client caches `globalThis.WebSocket` at module load (see transports/websocket.js).
 * If that runs before installMtlsWebSocketInterceptor(), Socket.IO uses plain RN WebSocket
 * without the client certificate and never connects on mTLS hosts.
 *
 * Patch createSocket to resolve WebSocket when each connection opens.
 */
export function patchEngineIoWebSocketTransport(): void {
  if (engineIoWebSocketPatched || Platform.OS === 'web') {
    return;
  }

  if (!EngineIoWebSocketTransport?.prototype) {
    console.warn('[Presence][MtlsWebSocket] engine.io WebSocket transport unavailable; skip patch');
    return;
  }

  EngineIoWebSocketTransport.prototype.createSocket = function createSocketWithLiveWebSocketCtor(
    uri: string,
    protocols: string | string[] | undefined,
    opts: { headers?: Record<string, string> },
  ): WebSocket {
    type WebSocketCtor = new (
      url: string | URL,
      protocols?: string | string[],
      options?: { headers?: Record<string, string> },
    ) => WebSocket;

    const WebSocketCtor = globalThis.WebSocket as unknown as WebSocketCtor;
    if (!isReactNative) {
      return protocols ? new WebSocketCtor(uri, protocols) : new WebSocketCtor(uri);
    }
    return new WebSocketCtor(uri, protocols, opts);
  };

  engineIoWebSocketPatched = true;
}
