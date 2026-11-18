import { config } from '../app/config';
import { base64Field, runHelper } from './helper-process';

/**
 * Talks to the bundled C helper (native/transit-key/windows-key.c → transit-key.exe) that keeps
 * the transit key in Windows CNG: the TPM, or the software key storage provider. Windows keeps
 * the key by name per Windows user, so nothing is stored by the app.
 */

const HELPER = 'transit-key.exe';
/**
 * One key per app flavor (XyneTransitKey, XyneTransitKey-dev, XyneTransitKey-sandbox), as on
 * macOS where each flavor keeps its own Enclave handle in its own userData.
 */
const KEY_NAME = `XyneTransitKey${config.USER_DATA_SUFFIX}`;

export type WindowsKeyProvider = 'tpm' | 'software';

/** ECDH with the provider's key (created on first use) and a server's uncompressed P-256 point. */
export async function windowsAgree(
  provider: WindowsKeyProvider,
  serverPoint: Uint8Array
): Promise<{ secret: Buffer; publicKey: Buffer }> {
  const output = await runHelper(
    HELPER,
    ['agree', provider, KEY_NAME],
    Buffer.from(serverPoint).toString('base64')
  );
  return { secret: base64Field(output, 'secret'), publicKey: base64Field(output, 'publicKey') };
}

// windows-key.c's messages for a failure on the key itself, after the provider opened.
const KEY_FAILURES = [
  'cannot open or create the key',
  'cannot read the public key',
  'key agreement failed',
];

/**
 * Whether the helper ran, opened the provider and then failed on the key: only then is there a
 * key worth replacing. A missing or hung helper, or a provider that cannot be opened (no TPM,
 * say), has none.
 */
export function isKeyFailure(error: unknown): boolean {
  return error instanceof Error && KEY_FAILURES.some((failure) => error.message.includes(failure));
}

/** Removes the provider's key, so the next agree creates a fresh one. */
export async function deleteWindowsKey(provider: WindowsKeyProvider): Promise<void> {
  await runHelper(HELPER, ['delete', provider, KEY_NAME], '');
}
