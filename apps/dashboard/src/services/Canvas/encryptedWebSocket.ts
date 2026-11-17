import type { YSweetAuthToken } from './canvasService';

// Wire format shared with y-sweet `ws_crypto.rs`. Nonce = direction ‖ u64 counter, so a frame
// that is replayed, reordered or reflected back fails to decrypt.
const HANDSHAKE_PREFIX = [0xe0, 0x01];
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

type Session = { key: CryptoKey; handshake: Uint8Array<ArrayBuffer> };

async function newSessionKey(publicKey: string): Promise<Session> {
  const spki = Uint8Array.from(atob(publicKey), c => c.charCodeAt(0));
  const rsa = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsa, raw));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  raw.fill(0);
  const handshake = new Uint8Array(HANDSHAKE_PREFIX.length + wrapped.length);
  handshake.set(HANDSHAKE_PREFIX);
  handshake.set(wrapped, HANDSHAKE_PREFIX.length);
  return { key, handshake };
}

class EncryptedWebSocket {
  binaryType: BinaryType = 'arraybuffer';
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  private readonly ws: WebSocket;
  private readonly session: Promise<Session>;
  private handshakeSent = false;
  private sendCounter = 0n;
  private recvCounter = 0n;
  // WebCrypto is async. Both chains keep frames, and their counters, in order.
  private sendChain = Promise.resolve();
  private recvChain = Promise.resolve();

  constructor(url: string | URL, session: Promise<Session>) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.session = session;
    this.session.catch(() => this.ws.close());

    this.ws.onopen = (ev): void => {
      void this.session.then(
        ({ handshake }) => {
          if (this.ws.readyState !== OPEN) return;
          this.ws.send(handshake);
          this.handshakeSent = true;
          this.onopen?.(ev);
        },
        () => {},
      );
    };
    this.ws.onmessage = (ev: MessageEvent<ArrayBuffer>): void => {
      const iv = nonce(SERVER_TO_CLIENT, this.recvCounter++);
      this.recvChain = this.recvChain
        .then(async () => {
          const { key } = await this.session;
          const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ev.data);
          this.onmessage?.(new MessageEvent('message', { data }));
        })
        .catch(() => this.ws.close());
    };
    this.ws.onclose = (ev): void => this.onclose?.(ev);
    this.ws.onerror = (ev): void => this.onerror?.(ev);
  }

  get readyState(): number {
    const state = this.ws.readyState;
    return state === OPEN && !this.handshakeSent ? CONNECTING : state;
  }

  send(data: Uint8Array<ArrayBuffer>): void {
    const iv = nonce(CLIENT_TO_SERVER, this.sendCounter++);
    this.sendChain = this.sendChain
      .then(async () => {
        const { key } = await this.session;
        const frame = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
        if (this.ws.readyState === OPEN) this.ws.send(frame);
      })
      .catch(() => this.ws.close());
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }
}

const toBase64 = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));

/**
 * Encrypts the provider's sockets when y-sweet publishes a `wsPublicKey`, so y-sweet's
 * Y_SWEET_WS_ENCRYPTION is the only switch. Each ticket is bound to the hash of the handshake
 * made for it, so a ticket read in transit cannot open a socket.
 */
export function withFrameEncryption(
  getTicket: (wsHandshakeHash?: string) => Promise<YSweetAuthToken>,
  wsPublicKey: string | undefined,
): {
  getAuthToken: () => Promise<YSweetAuthToken>;
  WebSocketPolyfill: typeof WebSocket;
} {
  let publicKey = wsPublicKey;
  const sessions = new Map<string, Promise<Session>>();

  // @y-sweet/client calls `new WebSocketPolyfill(url)` with the ticket that getAuthToken returned.
  function WebSocketPolyfill(url: string | URL): unknown {
    const ticket = new URL(url).searchParams.get('token') ?? '';
    const session = sessions.get(ticket);
    sessions.delete(ticket);
    // No session means y-sweet does not encrypt.
    return session ? new EncryptedWebSocket(url, session) : new WebSocket(url);
  }
  Object.assign(WebSocketPolyfill, { CONNECTING, OPEN, CLOSING, CLOSED });

  return {
    getAuthToken: async (): Promise<YSweetAuthToken> => {
      const session = publicKey ? newSessionKey(publicKey) : undefined;
      const hash = session
        ? toBase64(await crypto.subtle.digest('SHA-256', (await session).handshake))
        : undefined;
      const token = await getTicket(hash);
      // y-sweet may have turned encryption on or off, or changed its key, since the last ticket.
      publicKey = token.wsPublicKey;
      sessions.clear();
      if (session && token.wsPublicKey && token.token) sessions.set(token.token, session);
      return token;
    },
    WebSocketPolyfill: WebSocketPolyfill as unknown as typeof WebSocket,
  };
}
