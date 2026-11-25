import { NativeModules } from 'react-native';

/**
 * Where the native module keeps the transit key; each device has one, chosen by what it has.
 * Android: the Keystore (`strongbox`, `tee`, or `unknown_secure` for secure hardware of a kind
 * it does not name) on a phone whose secure hardware does key agreement, else `wrapped`, a key
 * stored encrypted by the Keystore.
 * iOS: `secure_enclave`, else (the Simulator) `keychain`, a key kept in the Keychain.
 */
export type NativeTransitKeyStorage =
  'strongbox' | 'tee' | 'unknown_secure' | 'wrapped' | 'secure_enclave' | 'keychain';

/**
 * The transit key module (plugins/android-modules/transitkey on Android, plugins/ios-modules/
 * TransitKeyModule on iOS): an ECDH P-256 key kept by the OS; only ECDH results come out.
 * Values are base64. Rejections read `<store>: <reason>`, the store being `keystore`, `wrapped`,
 * `secure_enclave` or `keychain`.
 */
export interface LotusTransitKeyModule {
  getPublicKey(): Promise<{ publicKey: string; storage: NativeTransitKeyStorage }>;
  deriveSharedSecret(serverPoint: string): Promise<string>;
}

/** Missing on platforms without the module and on binaries built before it (OTA bundles). */
export const LotusTransitKey = NativeModules['LotusTransitKey'] as
  LotusTransitKeyModule | undefined;
