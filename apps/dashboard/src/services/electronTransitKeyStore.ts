import type { TransitKeyPair, TransitKeyStore } from '@xyne/shared';
import type { ElectronAPI } from '../types/electron';

/**
 * The desktop app's transit key. The private key stays in the main process (the Secure
 * Enclave on macOS); this page only receives the public key and ECDH results. Nothing is
 * stored in IndexedDB. Throws on desktop builds without the API, so the chain falls back.
 */

/** The main process gives up on the Secure Enclave well before this; it is a backstop. */
const DERIVE_TIMEOUT_MS = 6000;

type TransitKeyApi = NonNullable<ElectronAPI['transitKey']>;

function transitKeyApi(): TransitKeyApi {
  const api = (window as Window & { electronAPI?: ElectronAPI }).electronAPI?.transitKey;
  if (!api) throw new Error('This desktop app version holds no transit key');
  return api;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Desktop transit key timed out')), timeoutMs);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

export const electronTransitKeyStore: TransitKeyStore = {
  async getOrCreate(): Promise<TransitKeyPair> {
    const api = transitKeyApi();
    const publicKey = await api.getPublicKey();
    return {
      publicKey: toBase64(publicKey),
      async deriveSharedSecret(serverPoint): Promise<ArrayBuffer> {
        const secret = await withTimeout(api.deriveSharedSecret(serverPoint), DERIVE_TIMEOUT_MS);
        return secret.slice().buffer;
      },
    };
  },
};
