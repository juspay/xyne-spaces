import { waitFor } from 'xstate';
import { encryptionActor, getEncryptionState } from '../../machines/encryptionMachine';
import type { YSweetAuthToken } from './canvasService';

// Wire format shared with y-sweet `ws_crypto.rs`. Nonce = direction ‖ u64 counter, so a frame
// that is replayed, reordered or reflected back fails to decrypt.
const CLIENT_TO_SERVER = 1;
const SERVER_TO_CLIENT = 2;
const { CONNECTING, OPEN, CLOSING, CLOSED } = WebSocket;

const nonce = (direction: number, counter: bigint): Uint8Array<ArrayBuffer> => {
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  view.setUint32(0, direction);
  view.setBigUint64(4, counter);
  return iv;
};

class EncryptedWebSocket {
  binaryType: BinaryType = 'arraybuffer';
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  private readonly ws: WebSocket;
  private readonly key: CryptoKey;
  private sendCounter = 0n;
  private recvCounter = 0n;
  // WebCrypto is async. Both chains keep frames, and their counters, in order.
  private sendChain = Promise.resolve();
  private recvChain = Promise.resolve();

  constructor(url: string | URL, key: CryptoKey) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.key = key;

    this.ws.onopen = (ev): void => this.onopen?.(ev);
    this.ws.onmessage = (ev: MessageEvent<ArrayBuffer>): void => {
      const iv = nonce(SERVER_TO_CLIENT, this.recvCounter++);
      this.recvChain = this.recvChain
        .then(async () => {
          const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.key, ev.data);
          this.onmessage?.(new MessageEvent('message', { data }));
        })
        .catch(() => this.ws.close());
    };
    this.ws.onclose = (ev): void => this.onclose?.(ev);
    this.ws.onerror = (ev): void => this.onerror?.(ev);
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  send(data: Uint8Array<ArrayBuffer>): void {
    const iv = nonce(CLIENT_TO_SERVER, this.sendCounter++);
    this.sendChain = this.sendChain
      .then(async () => {
        const frame = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, data);
        if (this.ws.readyState === OPEN) this.ws.send(frame);
      })
      .catch(() => this.ws.close());
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }
}

/**
 * Encrypts the provider's sockets when the ticket carries a nonce. The key is derived from this
 * browser's transit key, so it is never on the wire. A ticket without a nonce means y-sweet runs
 * unencrypted, and y-sweet refuses a plain socket when it does not.
 */
export function withFrameEncryption(getTicket: () => Promise<YSweetAuthToken>): {
  getAuthToken: () => Promise<YSweetAuthToken>;
  WebSocketPolyfill: typeof WebSocket;
} {
  const keys = new Map<string, CryptoKey>();

  // @y-sweet/client calls `new WebSocketPolyfill(url)` with the ticket that getAuthToken returned.
  function WebSocketPolyfill(url: string | URL): unknown {
    const ticket = new URL(url).searchParams.get('token') ?? '';
    const key = keys.get(ticket);
    keys.delete(ticket);
    return key ? new EncryptedWebSocket(url, key) : new WebSocket(url);
  }
  Object.assign(WebSocketPolyfill, { CONNECTING, OPEN, CLOSING, CLOSED });

  return {
    getAuthToken: async (): Promise<YSweetAuthToken> => {
      const token = await getTicket();
      keys.clear();
      if (token.token && token.nonce && token.keyVersion !== undefined) {
        // A canvas can open before the transit key registration finishes.
        await waitFor(encryptionActor, s => s.matches('ready'), { timeout: 10_000 });
        const { keyring } = getEncryptionState();
        if (!keyring) throw new Error('Transit keys are not ready for an encrypted canvas socket');
        keys.set(token.token, await keyring.socketKey(token.keyVersion, token.nonce, token.docId));
      }
      return token;
    },
    WebSocketPolyfill: WebSocketPolyfill as unknown as typeof WebSocket,
  };
}
