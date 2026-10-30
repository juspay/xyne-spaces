import { RNE2EEManager, RNKeyProvider } from '@livekit/react-native';
import type { E2EEOptions, Room } from 'livekit-client';
import type { CallEncryptionCredentials } from '@xyne/shared';

/**
 * End-to-end encryption for calls on mobile.
 *
 * The backend hands each participant the call key in the initiate/join response
 * (never in a push). The key goes straight into LiveKit's key provider here and
 * nowhere else: never into room or participant metadata, data messages, URLs or
 * logs, since LiveKit sees all of those. Data-channel encryption is on so in-call
 * chat and control messages are covered too.
 */

const keyProviders = new WeakMap<E2EEOptions, RNKeyProvider>();
const roomKeyProviders = new WeakMap<Room, RNKeyProvider>();

/** Options for `new Room({ encryption })`. Call `attachRoomEncryption` with the created room. */
export function createRoomEncryptionOptions(): E2EEOptions {
  const keyProvider = new RNKeyProvider({ sharedKey: true });
  const options: E2EEOptions = { e2eeManager: new RNE2EEManager(keyProvider, true) };
  keyProviders.set(options, keyProvider);
  return options;
}

export function attachRoomEncryption(room: Room, options: E2EEOptions): void {
  const keyProvider = keyProviders.get(options);
  if (keyProvider) roomKeyProviders.set(room, keyProvider);
}

/** Load the call key and turn encryption on. Must complete before `room.connect`. */
export async function applyRoomEncryption(
  room: Room,
  credentials: CallEncryptionCredentials,
): Promise<void> {
  const keyProvider = roomKeyProviders.get(room);
  if (!keyProvider) {
    throw new Error('Room was created without encryption options');
  }
  // Same string as web: both sides must run PBKDF2 over identical input to get one key.
  await keyProvider.setSharedKey(credentials.key, credentials.keyIndex);
  await room.setE2EEEnabled(true);
}
