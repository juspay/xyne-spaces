import type { CallEncryptionCredentials } from '../zero/types.js';
import { decryptField, isEncryptedField } from './field-decrypt.js';
import type { TransitKeyring } from './keyring.js';

/**
 * The media key of a call to hand to LiveKit's key provider. A derived key comes as is; a key
 * from the encryption service is transit ciphertext of `{"callId","key"}` (or already
 * its plaintext, when the response interceptor decrypted it) and is rejected unless it was
 * issued for `roomName`, so a relayed key for another call can't be swapped in.
 */
export async function openCallKey(
  credentials: CallEncryptionCredentials,
  roomName: string,
  keyring: TransitKeyring | null,
): Promise<string> {
  if (credentials.encryptedKey === undefined) {
    if (typeof credentials.key !== 'string' || !credentials.key) throw new Error('Call key missing');
    return credentials.key;
  }
  let json = credentials.encryptedKey;
  if (isEncryptedField(json)) {
    if (!keyring) throw new Error('Call key is encrypted but no transit keyring is set');
    json = await decryptField(json, keyring);
  }
  const payload = JSON.parse(json) as { callId?: unknown; key?: unknown };
  if (payload.callId !== roomName) throw new Error('Call key was issued for another call');
  if (typeof payload.key !== 'string' || !payload.key) throw new Error('Call key missing');
  return payload.key;
}
