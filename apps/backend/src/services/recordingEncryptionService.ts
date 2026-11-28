import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import { Transform, type TransformCallback } from 'stream';
import { config } from '@/config/env';

/**
 * Encryption at rest for recordings of end-to-end encrypted calls.
 *
 * On an E2EE call no server sees media in clear except the transcription agent, which
 * holds the call key. When such a call is recorded, the agent records the audio it
 * already decrypts and stores it encrypted; nothing it writes is ever plaintext at rest.
 *
 * Key hierarchy (keys are never logged and never leave this process except as noted):
 *
 *   KEK ring: CALL_RECORDING_MASTER_KEY (+ retired versions), KMS-decrypted at boot
 *     └─ wraps a random 32-byte data key (DEK) per recording, stored wrapped on the row
 *          ├─ HKDF -> chunk key: sealed to the recording agent's one-time X25519 key; the
 *          │         agent encrypts live audio chunks and the manifest with it
 *          └─ HKDF -> file key: the stitch worker encrypts the final file (XREC container)
 *
 * The agent only ever holds the chunk key. Deleting the wrapped DEK (user delete,
 * retention) makes the recording unreadable everywhere, backups included.
 *
 * Every ciphertext is AES-256-GCM with associated data that pins it to its recording
 * and position, so blobs can't be swapped between recordings, tracks or offsets.
 */

const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

const WRAP_AAD_PREFIX = 'xyne-recording-dek:v1|';
const CHUNK_KEY_INFO = 'xyne-recording-chunk:v1';
const FILE_KEY_INFO = 'xyne-recording-file:v1';

/** Version byte of a live object (chunk or manifest) written by the agent. */
const LIVE_FORMAT_VERSION = 1;

/** XREC container: 32-byte header, then the plaintext in fixed-size GCM chunks. */
const XREC_MAGIC = Buffer.from('XREC', 'ascii');
const XREC_VERSION = 1;
export const XREC_HEADER_LENGTH = 32;
/** Plaintext bytes per container chunk. Small enough that a seek decrypts little extra. */
export const XREC_CHUNK_SIZE = 64 * 1024;

/** Stored on call_recordings.encryption. Only the wrapped key: the row alone decrypts nothing. */
export interface RecordingEncryptionState {
  v: 1;
  /** CALL_RECORDING_MASTER_KEY version that wrapped the key. */
  kekVersion: number;
  /** base64(nonce | ciphertext | tag) of the 32-byte data key. */
  wrappedKey: string;
}

export interface XrecHeader {
  chunkSize: number;
  plaintextLength: number;
  noncePrefix: Buffer;
  /** The raw 32 header bytes; authenticated as part of every chunk. */
  raw: Buffer;
}

export class RecordingDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordingDecryptionError';
  }
}

const decodeKey = (value: string, label: string): Buffer => {
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_LENGTH) throw new Error(`${label} must be 32 random bytes, base64 encoded`);
  return key;
};

const hkdf = (dek: Buffer, recordingId: string, info: string): Buffer =>
  Buffer.from(hkdfSync('sha256', dek, Buffer.from(recordingId, 'utf8'), Buffer.from(info, 'utf8'), KEY_LENGTH));

const gcmEncrypt = (key: Buffer, nonce: Buffer, aad: Buffer, plaintext: Buffer): Buffer => {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
};

const gcmDecrypt = (key: Buffer, nonce: Buffer, aad: Buffer, sealed: Buffer): Buffer => {
  if (sealed.length < TAG_LENGTH) throw new RecordingDecryptionError('ciphertext shorter than its tag');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LENGTH));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_LENGTH)), decipher.final()]);
  } catch {
    throw new RecordingDecryptionError('authentication failed');
  }
};

/**
 * AAD of one live audio chunk. `session` is the recording agent instance (a redispatched
 * agent resumes a recording under a new session). Must match python-agent/infra/recording_crypto.py.
 */
export const liveChunkAad = (recordingId: string, session: string, trackIndex: number, seq: number): Buffer =>
  Buffer.from(`xyne-rec-chunk:v1|${recordingId}|${session}|${trackIndex}|${seq}`, 'utf8');

/**
 * AAD of one live video chunk (the agent's composed video stream). A separate label from
 * audio chunks, so an audio chunk can never be passed off as video or the other way round.
 * Must match python-agent/infra/recording_crypto.py.
 */
export const liveVideoChunkAad = (recordingId: string, session: string, trackIndex: number, seq: number): Buffer =>
  Buffer.from(`xyne-rec-vchunk:v1|${recordingId}|${session}|${trackIndex}|${seq}`, 'utf8');

/** AAD of one agent session's manifest. Must match the agent. */
export const manifestAad = (recordingId: string, session: string): Buffer =>
  Buffer.from(`xyne-rec-manifest:v1|${recordingId}|${session}`, 'utf8');

/** Message the agent MACs with the chunk key to prove it holds it when it reports completion. */
export const completionProofMessage = (recordingId: string, session: string): Buffer =>
  Buffer.from(`xyne-rec-complete:v1|${recordingId}|${session}`, 'utf8');

/** Nonce of container chunk `index`: the header's random prefix with the index XORed into its last 8 bytes. */
const chunkNonce = (noncePrefix: Buffer, index: number): Buffer => {
  const nonce = Buffer.from(noncePrefix);
  const tail = nonce.readBigUInt64BE(4) ^ BigInt(index);
  nonce.writeBigUInt64BE(tail, 4);
  return nonce;
};

/** AAD of container chunk `index`: the whole header, the index and whether it is the last chunk. */
const chunkAad = (header: Buffer, index: number, isLast: boolean): Buffer => {
  const suffix = Buffer.alloc(9);
  suffix.writeBigUInt64BE(BigInt(index), 0);
  suffix.writeUInt8(isLast ? 1 : 0, 8);
  return Buffer.concat([header, suffix]);
};

const chunkCount = (header: Pick<XrecHeader, 'chunkSize' | 'plaintextLength'>): number =>
  Math.max(1, Math.ceil(header.plaintextLength / header.chunkSize));

/** Ciphertext length of a whole container. */
export const xrecCiphertextLength = (header: Pick<XrecHeader, 'chunkSize' | 'plaintextLength'>): number =>
  XREC_HEADER_LENGTH + header.plaintextLength + chunkCount(header) * TAG_LENGTH;

class RecordingEncryptionService {
  private ring: { currentVersion: number; keys: Map<number, Buffer> } | null | undefined;

  private keyRing(): { currentVersion: number; keys: Map<number, Buffer> } | null {
    if (this.ring !== undefined) return this.ring;
    const { masterKey, masterKeyVersion, previousMasterKeys } = config.callRecording;
    if (!masterKey) {
      this.ring = null;
      return null;
    }
    const keys = new Map<number, Buffer>();
    for (const [version, value] of Object.entries(previousMasterKeys)) {
      keys.set(Number(version), decodeKey(value, `CALL_RECORDING_PREVIOUS_MASTER_KEYS[${version}]`));
    }
    keys.set(masterKeyVersion, decodeKey(masterKey, 'CALL_RECORDING_MASTER_KEY'));
    this.ring = { currentVersion: masterKeyVersion, keys };
    return this.ring;
  }

  /** Whether recordings of encrypted calls can be made at all (a master key is configured). */
  isConfigured(): boolean {
    return this.keyRing() !== null;
  }

  /** A fresh data key for a new recording, and its wrapped form for the row. */
  createRecordingKey(recordingId: string): { state: RecordingEncryptionState; dek: Buffer } {
    const ring = this.keyRing();
    if (!ring) throw new Error('CALL_RECORDING_MASTER_KEY is not configured');
    const kek = ring.keys.get(ring.currentVersion)!;
    const dek = randomBytes(KEY_LENGTH);
    const nonce = randomBytes(NONCE_LENGTH);
    const sealed = gcmEncrypt(kek, nonce, Buffer.from(`${WRAP_AAD_PREFIX}${recordingId}`, 'utf8'), dek);
    return {
      state: { v: 1, kekVersion: ring.currentVersion, wrappedKey: Buffer.concat([nonce, sealed]).toString('base64') },
      dek,
    };
  }

  /** The data key of a recording. Throws if the state is malformed, shredded or not ours. */
  unwrapRecordingKey(recordingId: string, state: unknown): Buffer {
    const parsed = this.parseState(state);
    if (!parsed) throw new RecordingDecryptionError('recording has no encryption key');
    const kek = this.keyRing()?.keys.get(parsed.kekVersion);
    if (!kek) {
      throw new RecordingDecryptionError(
        `no recording master key for version ${parsed.kekVersion}; add it to CALL_RECORDING_PREVIOUS_MASTER_KEYS`,
      );
    }
    const blob = Buffer.from(parsed.wrappedKey, 'base64');
    if (blob.length !== NONCE_LENGTH + KEY_LENGTH + TAG_LENGTH) throw new RecordingDecryptionError('wrapped key has the wrong length');
    return gcmDecrypt(
      kek,
      blob.subarray(0, NONCE_LENGTH),
      Buffer.from(`${WRAP_AAD_PREFIX}${recordingId}`, 'utf8'),
      blob.subarray(NONCE_LENGTH),
    );
  }

  /** The row's encryption state if it is one this service wrote, else null (an unencrypted recording). */
  parseState(state: unknown): RecordingEncryptionState | null {
    if (!state || typeof state !== 'object') return null;
    const { v, kekVersion, wrappedKey } = state as Partial<RecordingEncryptionState>;
    if (v !== 1 || !Number.isInteger(kekVersion) || typeof wrappedKey !== 'string' || !wrappedKey) return null;
    return { v, kekVersion: kekVersion as number, wrappedKey };
  }

  isEncryptedRecording(recording: { encryption?: unknown }): boolean {
    return this.parseState(recording.encryption) !== null;
  }

  deriveChunkKey(dek: Buffer, recordingId: string): Buffer {
    return hkdf(dek, recordingId, CHUNK_KEY_INFO);
  }

  deriveFileKey(dek: Buffer, recordingId: string): Buffer {
    return hkdf(dek, recordingId, FILE_KEY_INFO);
  }

  /**
   * Decrypt one object the agent wrote (an audio chunk or the manifest):
   * version(1) | nonce(12) | ciphertext | tag(16).
   */
  decryptLiveObject(chunkKey: Buffer, aad: Buffer, blob: Buffer): Buffer {
    if (blob.length < 1 + NONCE_LENGTH + TAG_LENGTH) throw new RecordingDecryptionError('live object too short');
    if (blob[0] !== LIVE_FORMAT_VERSION) throw new RecordingDecryptionError(`unknown live object version ${blob[0]}`);
    return gcmDecrypt(chunkKey, blob.subarray(1, 1 + NONCE_LENGTH), aad, blob.subarray(1 + NONCE_LENGTH));
  }

  /** Same format as decryptLiveObject. The agent writes these; exposed for tests and tooling. */
  encryptLiveObject(chunkKey: Buffer, aad: Buffer, plaintext: Buffer): Buffer {
    const nonce = randomBytes(NONCE_LENGTH);
    return Buffer.concat([Buffer.from([LIVE_FORMAT_VERSION]), nonce, gcmEncrypt(chunkKey, nonce, aad, plaintext)]);
  }

  /** Encrypt a whole file into an XREC container (seekable: each chunk decrypts on its own). */
  encryptFile(fileKey: Buffer, plaintext: Buffer, chunkSize: number = XREC_CHUNK_SIZE): Buffer {
    const header = Buffer.alloc(XREC_HEADER_LENGTH);
    XREC_MAGIC.copy(header, 0);
    header.writeUInt8(XREC_VERSION, 4);
    header.writeUInt32BE(chunkSize, 8);
    header.writeBigUInt64BE(BigInt(plaintext.length), 12);
    randomBytes(NONCE_LENGTH).copy(header, 20);
    const noncePrefix = header.subarray(20, 32);

    const count = chunkCount({ chunkSize, plaintextLength: plaintext.length });
    const parts: Buffer[] = [header];
    for (let index = 0; index < count; index++) {
      const slice = plaintext.subarray(index * chunkSize, Math.min((index + 1) * chunkSize, plaintext.length));
      parts.push(gcmEncrypt(fileKey, chunkNonce(noncePrefix, index), chunkAad(header, index, index === count - 1), slice));
    }
    return Buffer.concat(parts);
  }

  parseHeader(raw: Buffer): XrecHeader {
    if (raw.length < XREC_HEADER_LENGTH) throw new RecordingDecryptionError('container header truncated');
    const header = Buffer.from(raw.subarray(0, XREC_HEADER_LENGTH));
    if (!header.subarray(0, 4).equals(XREC_MAGIC)) throw new RecordingDecryptionError('not an XREC container');
    if (header.readUInt8(4) !== XREC_VERSION) throw new RecordingDecryptionError(`unknown XREC version ${header.readUInt8(4)}`);
    const chunkSize = header.readUInt32BE(8);
    const plaintextLength = Number(header.readBigUInt64BE(12));
    if (chunkSize <= 0 || !Number.isSafeInteger(plaintextLength)) throw new RecordingDecryptionError('container header invalid');
    return { chunkSize, plaintextLength, noncePrefix: header.subarray(20, 32), raw: header };
  }

  /**
   * Which ciphertext bytes hold plaintext bytes [start, end] (inclusive), for a ranged
   * read from storage. Decrypt them with createDecryptStream(..., range).
   */
  ciphertextRange(header: XrecHeader, start: number, end: number): { start: number; end: number; firstChunk: number } {
    if (start < 0 || end < start || end >= header.plaintextLength) throw new RangeError('plaintext range out of bounds');
    const firstChunk = Math.floor(start / header.chunkSize);
    const lastChunk = Math.floor(end / header.chunkSize);
    const sealedChunk = header.chunkSize + TAG_LENGTH;
    const lastChunkStart = XREC_HEADER_LENGTH + lastChunk * sealedChunk;
    const lastChunkPlain = Math.min(header.chunkSize, header.plaintextLength - lastChunk * header.chunkSize);
    return {
      start: XREC_HEADER_LENGTH + firstChunk * sealedChunk,
      end: lastChunkStart + lastChunkPlain + TAG_LENGTH - 1,
      firstChunk,
    };
  }

  /**
   * A stream that decrypts container ciphertext as it flows. Feed it the bytes from
   * ciphertextRange(range) (or the whole file after the header, with no range); it emits
   * exactly plaintext bytes [range.start, range.end]. Any tampered chunk fails the stream.
   */
  createDecryptStream(fileKey: Buffer, header: XrecHeader, range?: { start: number; end: number }): Transform {
    const total = chunkCount(header);
    const sealedChunk = header.chunkSize + TAG_LENGTH;
    const plainStart = range?.start ?? 0;
    const plainEnd = range?.end ?? header.plaintextLength - 1;
    let index = Math.floor(plainStart / header.chunkSize);
    let pending: Buffer = Buffer.alloc(0);

    const sealedLengthOf = (i: number): number =>
      i === total - 1 ? header.plaintextLength - i * header.chunkSize + TAG_LENGTH : sealedChunk;

    const emitChunk = (stream: Transform, sealed: Buffer): void => {
      const plain = gcmDecrypt(fileKey, chunkNonce(header.noncePrefix, index), chunkAad(header.raw, index, index === total - 1), sealed);
      const chunkStart = index * header.chunkSize;
      const from = Math.max(plainStart - chunkStart, 0);
      const to = Math.min(plainEnd - chunkStart + 1, plain.length);
      if (to > from) stream.push(plain.subarray(from, to));
      index++;
    };

    return new Transform({
      transform(data: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
        try {
          pending = pending.length ? Buffer.concat([pending, data]) : data;
          while (index < total && index * header.chunkSize <= plainEnd && pending.length >= sealedLengthOf(index)) {
            const length = sealedLengthOf(index);
            emitChunk(this, pending.subarray(0, length));
            pending = pending.subarray(length);
          }
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
      flush(callback: TransformCallback) {
        if (index * header.chunkSize <= plainEnd && plainEnd >= 0 && header.plaintextLength > 0) {
          callback(new RecordingDecryptionError('container ciphertext truncated'));
          return;
        }
        callback();
      },
    });
  }

  /** Decrypt a whole container held in memory. */
  decryptFile(fileKey: Buffer, container: Buffer): Buffer {
    const header = this.parseHeader(container);
    if (container.length !== xrecCiphertextLength(header)) throw new RecordingDecryptionError('container length mismatch');
    const out: Buffer[] = [];
    const sealedChunk = header.chunkSize + TAG_LENGTH;
    const total = chunkCount(header);
    for (let index = 0; index < total; index++) {
      const start = XREC_HEADER_LENGTH + index * sealedChunk;
      const length = index === total - 1 ? header.plaintextLength - index * header.chunkSize + TAG_LENGTH : sealedChunk;
      out.push(gcmDecrypt(fileKey, chunkNonce(header.noncePrefix, index), chunkAad(header.raw, index, index === total - 1), container.subarray(start, start + length)));
    }
    return Buffer.concat(out);
  }
}

export const recordingEncryptionService = new RecordingEncryptionService();
