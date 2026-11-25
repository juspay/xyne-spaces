import { TransitKeyUnavailableError } from '@xyne/shared';
import type { TransitKeyPair, TransitKeyStore } from '@xyne/shared';
import type { ElectronAPI } from '../types/electron';

/**
 * The desktop app's transit key. The private key stays in the main process (Secure Enclave, TPM,
 * or the platform's software store); this page only receives the public key and ECDH results.
 * Nothing is stored in IndexedDB. Rejects with TransitKeyUnavailableError when the main process
 * cannot reach its key; see EncryptionBootstrapProvider.
 */

/** The main process gives up on the Secure Enclave well before this; it is a backstop. */
const DERIVE_TIMEOUT_MS = 6000;

type TransitKeyApi = NonNullable<ElectronAPI['transitKey']>;

function transitKeyApi(): TransitKeyApi {
  const api = (window as Window & { electronAPI?: ElectronAPI }).electronAPI?.transitKey;
  if (!api)
    throw new TransitKeyUnavailableError('desktop', 'This desktop app holds no transit key');
  return api;
}

/** The main process's `Transit key unavailable (<store>): <reason>`, behind IPC's own prefix. */
const MAIN_PROCESS_ERROR = /Transit key unavailable \(([\w-]+)\): ([\s\S]*)$/;

function toUnavailable(error: unknown): TransitKeyUnavailableError {
  if (error instanceof TransitKeyUnavailableError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const [, storage, reason] = MAIN_PROCESS_ERROR.exec(message) ?? [];
  return storage && reason !== undefined
    ? new TransitKeyUnavailableError(storage, reason)
    : new TransitKeyUnavailableError('desktop', message);
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
    try {
      const api = transitKeyApi();
      const publicKey = await api.getPublicKey();
      return {
        publicKey: toBase64(publicKey),
        async deriveSharedSecret(serverPoint): Promise<ArrayBuffer> {
          try {
            const secret = await withTimeout(
              api.deriveSharedSecret(serverPoint),
              DERIVE_TIMEOUT_MS,
            );
            return secret.slice().buffer;
          } catch (error: unknown) {
            throw toUnavailable(error);
          }
        },
      };
    } catch (error: unknown) {
      throw toUnavailable(error);
    }
  },
};
