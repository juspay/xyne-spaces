import { fromBase64, toBase64, TransitKeyUnavailableError } from '@xyne/shared';
import type { TransitKeyPair, TransitKeyStore } from '@xyne/shared';
import { LotusTransitKey } from '../../modules/transit-key/NativeTransitKeyModule';
import { Event, logger } from '../../utils/logger';

/**
 * The mobile app's transit key, kept by the OS through the native module: on Android the
 * Keystore (StrongBox, else the TEE) on a phone whose secure hardware does key agreement, else a
 * key stored encrypted by the Keystore; on iOS the Secure Enclave, else (the Simulator) a key kept
 * in the Keychain. Each phone has one of them, chosen by what it has, and a failure is never
 * answered with another. React Native has no WebCrypto, so the shared WebCrypto store does not
 * apply here: without the native module there is no transit key.
 */

/** As long as the dashboard gives a key store, so a stuck Keystore cannot stall the caller. */
const KEY_TIMEOUT_MS = 6000;

/** The native module's `<store>: <reason>` rejection. */
const NATIVE_ERROR = /^([a-z_]+): ([\s\S]*)$/;

function toUnavailable(error: unknown): TransitKeyUnavailableError {
  if (error instanceof TransitKeyUnavailableError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const [, storage, reason] = NATIVE_ERROR.exec(message) ?? [];
  return storage && reason !== undefined
    ? new TransitKeyUnavailableError(storage, reason)
    : new TransitKeyUnavailableError('native', message);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Native transit key timed out')), timeoutMs);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

/**
 * This binary was built before the native module, so only an app update can give it a key. A
 * TransitKeyUnavailableError like any other key store failure, so it is logged as one.
 */
export class TransitKeyModuleMissingError extends TransitKeyUnavailableError {
  constructor() {
    super('native', 'The transit key module is not in this build');
    this.name = 'TransitKeyModuleMissingError';
  }
}

async function getOrCreate(): Promise<TransitKeyPair> {
  const module = LotusTransitKey;
  if (!module) throw new TransitKeyModuleMissingError();
  const { publicKey, storage } = await withTimeout(module.getPublicKey(), KEY_TIMEOUT_MS);
  logger.info(Event.ENCRYPTION_KEY_GENERATED, { type: 'transit_key', storage });
  return {
    publicKey,
    async deriveSharedSecret(serverPoint: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
      try {
        const secret = await withTimeout(
          module.deriveSharedSecret(toBase64(serverPoint)),
          KEY_TIMEOUT_MS,
        );
        return fromBase64(secret).buffer;
      } catch (error: unknown) {
        throw toUnavailable(error);
      }
    },
  };
}

/**
 * The store the encryption bootstrap uses, after login. Rejects with TransitKeyUnavailableError,
 * without prompting and within the time limit, where there is no native key: binaries built
 * before the module (OTA bundles), or a Keystore or Enclave that fails. The bootstrap logs it at
 * error level and the app shows it.
 */
export const transitKeyStore: TransitKeyStore = {
  async getOrCreate(): Promise<TransitKeyPair> {
    try {
      return await getOrCreate();
    } catch (error: unknown) {
      throw toUnavailable(error);
    }
  },
};
