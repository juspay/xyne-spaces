import { ExternalE2EEKeyProvider, type E2EEOptions, type Room } from 'livekit-client';
import E2EEWorker from 'livekit-client/e2ee-worker?worker';
import type { CallEncryptionCredentials } from '@xyne/shared';

/**
 * End-to-end encryption for calls (web, desktop, external guests).
 *
 * The backend hands each participant the call key in the initiate/join response.
 * The key goes straight into LiveKit's key provider here and nowhere else: never
 * into room or participant metadata, data messages, URLs or logs, since LiveKit
 * sees all of those. The `encryption` room option (not the deprecated `e2ee`)
 * also covers data messages, so in-call chat and whiteboard are encrypted too.
 */

const keyProviders = new WeakMap<Room, ExternalE2EEKeyProvider>();

/** Options for `new Room(...)`. Call `attachRoomEncryption` with the created room. */
export function createRoomEncryptionOptions(): E2EEOptions {
  return { keyProvider: new ExternalE2EEKeyProvider(), worker: new E2EEWorker() };
}

export function attachRoomEncryption(room: Room, options: E2EEOptions): void {
  if ('keyProvider' in options && options.keyProvider instanceof ExternalE2EEKeyProvider) {
    keyProviders.set(room, options.keyProvider);
  }
}

/** Load the call key and turn encryption on. Must complete before `room.connect`. */
export async function applyRoomEncryption(
  room: Room,
  credentials: CallEncryptionCredentials,
): Promise<void> {
  const keyProvider = keyProviders.get(room);
  if (!keyProvider) {
    throw new Error('Room was created without encryption options');
  }
  await keyProvider.setKey(base64ToArrayBuffer(credentials.key));
  await room.setE2EEEnabled(true);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
