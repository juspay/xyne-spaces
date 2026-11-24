import { fromBase64, toBase64 } from '@xyne/shared';
import type { TransitKeyPair, TransitKeyStore } from '@xyne/shared';
import { LotusTransitKey } from '../../modules/transit-key/NativeTransitKeyModule';
import { Event, logger } from '../../utils/logger';

/**
 * The mobile app's transit key, kept by the OS through the native module: on Android the
 * Keystore (StrongBox, else the TEE), else a key stored encrypted by the Keystore; on iOS the
 * Secure Enclave, else a key kept in the Keychain. React Native has no WebCrypto, so the shared
 * WebCrypto stores do not apply here, and there is no memory fallback: without the native
 * module there is no transit key.
 */

/** As long as the dashboard gives a key store, so a stuck Keystore cannot stall the caller. */
const KEY_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Native transit key timed out')), timeoutMs);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

/** This binary was built before the native module, so only an app update can give it a key. */
export class TransitKeyModuleMissingError extends Error {
  constructor() {
    super('The transit key module is not in this build');
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
      const secret = await withTimeout(
        module.deriveSharedSecret(toBase64(serverPoint)),
        KEY_TIMEOUT_MS,
      );
      return fromBase64(secret).buffer;
    },
  };
}

/**
 * The store the encryption bootstrap uses, after login. Rejects, without prompting and within
 * the time limit, where there is no native key: binaries built before the module (OTA bundles)
 * or a Keystore that fails outright.
 */
export const transitKeyStore: TransitKeyStore = {
  async getOrCreate(): Promise<TransitKeyPair> {
    try {
      return await getOrCreate();
    } catch (error: unknown) {
      logger.warn(Event.ENCRYPTION_KEY_GENERATED, {
        type: 'transit_key',
        message: '[TransitKey] No native transit key',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
