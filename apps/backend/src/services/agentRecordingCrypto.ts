import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * The objects the recording agent uploads while it records an end-to-end encrypted call
 * (python-agent/infra/recording_crypto.py writes them; the stitch worker reads them).
 *
 * The key is a per-recording storage key from the encryption service
 * (EncryptionProvider.generateStorageKey). The agent holds the key itself, sealed to its job;
 * the wrapped key travels in each object's `enc-wdek` metadata, like any other encrypted
 * storage object. With storage encryption off, the agent writes these objects in clear.
 *
 *   object = version(1) | nonce(12) | AES-256-GCM ciphertext | tag(16)
 *
 * The associated data pins each object to its recording, agent session, track and position,
 * so the stitch worker rejects anything swapped, reordered or replayed.
 */

const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const LIVE_FORMAT_VERSION = 1;

export class RecordingDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordingDecryptionError';
  }
}

/**
 * AAD of one live audio chunk. `session` is the recording agent instance (a redispatched
 * agent resumes a recording under a new session). Must match python-agent/infra/recording_crypto.py.
 */
export const liveChunkAad = (recordingId: string, session: string, trackIndex: number, seq: number): Buffer =>
  Buffer.from(`xyne-rec-chunk:v1|${recordingId}|${session}|${trackIndex}|${seq}`, 'utf8');

/**
 * AAD of one live video chunk (the agent's composed video stream). A separate label from
 * audio chunks, so an audio chunk can never be passed off as video or the other way round.
 */
export const liveVideoChunkAad = (recordingId: string, session: string, trackIndex: number, seq: number): Buffer =>
  Buffer.from(`xyne-rec-vchunk:v1|${recordingId}|${session}|${trackIndex}|${seq}`, 'utf8');

/** AAD of one agent session's manifest. */
export const manifestAad = (recordingId: string, session: string): Buffer =>
  Buffer.from(`xyne-rec-manifest:v1|${recordingId}|${session}`, 'utf8');

/** Message the agent MACs with the recording key to prove it holds it when it reports completion. */
export const completionProofMessage = (recordingId: string, session: string): Buffer =>
  Buffer.from(`xyne-rec-complete:v1|${recordingId}|${session}`, 'utf8');

/** Decrypt one object the agent wrote (a chunk or a manifest). Throws on any tampering. */
export function decryptLiveObject(key: Buffer, aad: Buffer, blob: Buffer): Buffer {
  if (blob.length < 1 + NONCE_LENGTH + TAG_LENGTH) throw new RecordingDecryptionError('live object too short');
  if (blob[0] !== LIVE_FORMAT_VERSION) throw new RecordingDecryptionError(`unknown live object version ${blob[0]}`);
  const nonce = blob.subarray(1, 1 + NONCE_LENGTH);
  const sealed = blob.subarray(1 + NONCE_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LENGTH));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_LENGTH)), decipher.final()]);
  } catch {
    throw new RecordingDecryptionError('authentication failed');
  }
}

/** Same format as decryptLiveObject. The agent writes these; exposed for tests. */
export function encryptLiveObject(key: Buffer, aad: Buffer, plaintext: Buffer): Buffer {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  return Buffer.concat([Buffer.from([LIVE_FORMAT_VERSION]), nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}
