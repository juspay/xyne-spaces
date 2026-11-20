import { NativeModules } from 'react-native';

/**
 * Where the native module keeps the transit key.
 * Android: the Keystore itself (`strongbox`, `tee`, or `software` where the Keystore has no
 * secure hardware), or `wrapped`, a key stored encrypted by the Keystore whenever the Keystore
 * key fails (Android 11 and older cannot do key agreement in it).
 * iOS: `secure_enclave`, or `keychain`, a key kept in the Keychain whenever the Enclave key
 * fails (and in the Simulator).
 */
export type NativeTransitKeyStorage =
  'strongbox' | 'tee' | 'software' | 'wrapped' | 'secure_enclave' | 'keychain';

/**
 * The transit key module (plugins/android-modules/transitkey on Android, plugins/ios-modules/
 * TransitKeyModule on iOS): an ECDH P-256 key kept by the OS; only ECDH results come out.
 * Values are base64.
 */
export interface LotusTransitKeyModule {
  getPublicKey(): Promise<{ publicKey: string; storage: NativeTransitKeyStorage }>;
  deriveSharedSecret(serverPoint: string): Promise<string>;
}

/** Missing on platforms without the module and on binaries built before it (OTA bundles). */
export const LotusTransitKey = NativeModules['LotusTransitKey'] as
  LotusTransitKeyModule | undefined;
