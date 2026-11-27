import type { CallEncryptionCredentials } from '@xyne/shared';

/**
 * The media key of a call to hand to LiveKit's key provider. A derived key comes as is. A key
 * from the encryption service arrives as `{"callId","key"}`, which the response interceptor
 * has already decrypted with this client's transit key; it is rejected unless it was issued
 * for `roomName`, so a relayed key for another call can't be swapped in.
 */
export function openCallKey(credentials: CallEncryptionCredentials, roomName: string): string {
  if (credentials.encryptedKey === undefined) {
    if (typeof credentials.key !== 'string' || !credentials.key)
      throw new Error('Call key missing');
    return credentials.key;
  }
  let payload: { callId?: unknown; key?: unknown };
  try {
    payload = JSON.parse(credentials.encryptedKey) as { callId?: unknown; key?: unknown };
  } catch {
    throw new Error('Call key was not decrypted');
  }
  if (payload.callId !== roomName) throw new Error('Call key was issued for another call');
  if (typeof payload.key !== 'string' || !payload.key) throw new Error('Call key missing');
  return payload.key;
}
