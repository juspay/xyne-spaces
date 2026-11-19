import { NativeModules } from 'react-native';

/**
 * Where the native module keeps the transit key: the Keystore itself (`strongbox`, `tee`, or
 * `software` where the Keystore has no secure hardware), or `wrapped`, a key stored encrypted
 * by the Keystore on phones whose Keystore cannot do key agreement (Android 11 and older).
 */
export type NativeTransitKeyStorage = 'strongbox' | 'tee' | 'software' | 'wrapped';

/**
 * The transit key module (plugins/android-modules/transitkey): an ECDH P-256 key kept by the OS;
 * only ECDH results come out. Values are base64.
 */
export interface LotusTransitKeyModule {
  getPublicKey(): Promise<{ publicKey: string; storage: NativeTransitKeyStorage }>;
  deriveSharedSecret(serverPoint: string): Promise<string>;
}

/** Missing on platforms without the module and on binaries built before it (OTA bundles). */
export const LotusTransitKey = NativeModules['LotusTransitKey'] as
  | LotusTransitKeyModule
  | undefined;
