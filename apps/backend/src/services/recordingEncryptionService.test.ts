const KEY_V1 = Buffer.alloc(32, 1).toString('base64');
const KEY_V2 = Buffer.alloc(32, 2).toString('base64');

const callRecording = {
  masterKey: KEY_V2,
  masterKeyVersion: 2,
  previousMasterKeys: { '1': KEY_V1 } as Record<string, string>,
};

jest.mock('@/config/env', () => ({ config: { callRecording } }));

import { createCipheriv, randomBytes } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  completionProofMessage,
  liveChunkAad,
  liveVideoChunkAad,
  manifestAad,
  RecordingDecryptionError,
  recordingEncryptionService as svc,
  XREC_HEADER_LENGTH,
  xrecCiphertextLength,
} from './recordingEncryptionService';

const collect = async (source: Buffer, transform: NodeJS.ReadWriteStream, sliceSize = 997): Promise<Buffer> => {
  const parts: Buffer[] = [];
  const pieces: Buffer[] = [];
  for (let i = 0; i < source.length; i += sliceSize) pieces.push(source.subarray(i, i + sliceSize));
  transform.on('data', (d: Buffer) => parts.push(d));
  await pipeline(Readable.from(pieces), transform);
  return Buffer.concat(parts);
};

describe('recordingEncryptionService key wrapping', () => {
  it('wraps a fresh data key with the current master key version and unwraps it', () => {
    const { state, dek } = svc.createRecordingKey('rec-1');
    expect(state).toMatchObject({ v: 1, kekVersion: 2 });
    expect(dek.length).toBe(32);
    expect(svc.unwrapRecordingKey('rec-1', state).equals(dek)).toBe(true);
    expect(JSON.stringify(state)).not.toContain(dek.toString('base64'));
  });

  it('binds the wrapped key to its recording', () => {
    const { state } = svc.createRecordingKey('rec-1');
    expect(() => svc.unwrapRecordingKey('rec-2', state)).toThrow(RecordingDecryptionError);
  });

  it('unwraps keys wrapped with a retired version still in the ring', () => {
    const kek = Buffer.from(KEY_V1, 'base64');
    const dek = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', kek, nonce);
    cipher.setAAD(Buffer.from('xyne-recording-dek:v1|rec-old'));
    const sealed = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()]);
    const state = { v: 1, kekVersion: 1, wrappedKey: Buffer.concat([nonce, sealed]).toString('base64') };
    expect(svc.unwrapRecordingKey('rec-old', state).equals(dek)).toBe(true);
  });

  it('refuses unknown versions, shredded and malformed state', () => {
    const { state } = svc.createRecordingKey('rec-1');
    expect(() => svc.unwrapRecordingKey('rec-1', { ...state, kekVersion: 9 })).toThrow(/version 9/);
    expect(() => svc.unwrapRecordingKey('rec-1', null)).toThrow(RecordingDecryptionError);
    expect(() => svc.unwrapRecordingKey('rec-1', { v: 2, kekVersion: 2, wrappedKey: 'x' })).toThrow(RecordingDecryptionError);
    expect(svc.isEncryptedRecording({ encryption: null })).toBe(false);
    expect(svc.isEncryptedRecording({ encryption: state })).toBe(true);
  });

  it('derives distinct chunk and file keys per recording', () => {
    const dek = randomBytes(32);
    const chunk = svc.deriveChunkKey(dek, 'rec-1');
    const file = svc.deriveFileKey(dek, 'rec-1');
    expect(chunk.equals(file)).toBe(false);
    expect(svc.deriveChunkKey(dek, 'rec-2').equals(chunk)).toBe(false);
  });
});

describe('live objects (agent chunks and manifests)', () => {
  const key = randomBytes(32);
  const session = '0123456789abcdef';

  it('round-trips and is bound to recording, session, track and position', () => {
    const aad = liveChunkAad('rec-1', session, 2, 5);
    const blob = svc.encryptLiveObject(key, aad, Buffer.from('ogg bytes'));
    expect(svc.decryptLiveObject(key, aad, blob).toString()).toBe('ogg bytes');
    for (const other of [
      liveChunkAad('rec-2', session, 2, 5),
      liveChunkAad('rec-1', 'fedcba9876543210', 2, 5),
      liveChunkAad('rec-1', session, 3, 5),
      liveChunkAad('rec-1', session, 2, 6),
      liveVideoChunkAad('rec-1', session, 2, 5),
      manifestAad('rec-1', session),
    ]) {
      expect(() => svc.decryptLiveObject(key, other, blob)).toThrow(RecordingDecryptionError);
    }
  });

  it('keeps video chunks apart from audio chunks', () => {
    const aad = liveVideoChunkAad('rec-1', session, 0, 3);
    const blob = svc.encryptLiveObject(key, aad, Buffer.from('ts bytes'));
    expect(svc.decryptLiveObject(key, aad, blob).toString()).toBe('ts bytes');
    expect(() => svc.decryptLiveObject(key, liveChunkAad('rec-1', session, 0, 3), blob)).toThrow(RecordingDecryptionError);
    expect(() => svc.decryptLiveObject(key, liveVideoChunkAad('rec-1', session, 0, 4), blob)).toThrow(RecordingDecryptionError);
  });

  it('rejects tampering, truncation and unknown versions', () => {
    const aad = manifestAad('rec-1', session);
    const blob = svc.encryptLiveObject(key, aad, Buffer.from('{"v":1}'));
    const flipped = Buffer.from(blob);
    flipped[20] ^= 1;
    expect(() => svc.decryptLiveObject(key, aad, flipped)).toThrow(RecordingDecryptionError);
    expect(() => svc.decryptLiveObject(key, aad, blob.subarray(0, 20))).toThrow(RecordingDecryptionError);
    const v2 = Buffer.from(blob);
    v2[0] = 2;
    expect(() => svc.decryptLiveObject(key, aad, v2)).toThrow(/version 2/);
  });

  it('decrypts the cross-language vector the python agent tests against', () => {
    // Same vector as python-agent/tests/test_recording_crypto.py: key 0x07*32, nonce 0x01*12.
    const vectorKey = Buffer.alloc(32, 7);
    const blob = Buffer.from(
      '01' + '010101010101010101010101' + PY_VECTOR_CIPHERTEXT_HEX,
      'hex',
    );
    expect(svc.decryptLiveObject(vectorKey, liveChunkAad('rec-vector', session, 2, 5), blob).toString()).toBe('hello opus');
  });

  it('builds the completion proof message the agent signs', () => {
    expect(completionProofMessage('rec-1', session).toString()).toBe(`xyne-rec-complete:v1|rec-1|${session}`);
  });
});

describe('XREC container', () => {
  const key = randomBytes(32);

  it.each([0, 1, 100, 1024, 1025, 4096 * 3, 4096 * 3 + 17])('round-trips %i bytes', (size) => {
    const plaintext = randomBytes(size);
    const container = svc.encryptFile(key, plaintext, 1024);
    const header = svc.parseHeader(container);
    expect(header.plaintextLength).toBe(size);
    expect(container.length).toBe(xrecCiphertextLength(header));
    expect(svc.decryptFile(key, container).equals(plaintext)).toBe(true);
  });

  it('decrypts arbitrary ranges from just the chunks that hold them', async () => {
    const plaintext = randomBytes(10_000);
    const container = svc.encryptFile(key, plaintext, 1024);
    const header = svc.parseHeader(container);
    const ranges: Array<[number, number]> = [
      [0, 0], [0, 1023], [1023, 1024], [1000, 3000], [9_999, 9_999], [5_000, 9_999], [0, 9_999], [2048, 2048],
    ];
    for (const [start, end] of ranges) {
      const cipher = svc.ciphertextRange(header, start, end);
      const slice = container.subarray(cipher.start, cipher.end + 1);
      const out = await collect(slice, svc.createDecryptStream(key, header, { start, end }), 333);
      expect(out.equals(plaintext.subarray(start, end + 1))).toBe(true);
    }
  });

  it('streams the whole file when given no range', async () => {
    const plaintext = randomBytes(5_000);
    const container = svc.encryptFile(key, plaintext, 1024);
    const header = svc.parseHeader(container);
    const out = await collect(container.subarray(XREC_HEADER_LENGTH), svc.createDecryptStream(key, header));
    expect(out.equals(plaintext)).toBe(true);
  });

  it('fails on a tampered chunk, a truncated stream, the wrong key or an altered header', async () => {
    const plaintext = randomBytes(5_000);
    const container = svc.encryptFile(key, plaintext, 1024);
    const header = svc.parseHeader(container);

    const tampered = Buffer.from(container);
    tampered[XREC_HEADER_LENGTH + 1024 + 16 + 5] ^= 1;
    await expect(collect(tampered.subarray(XREC_HEADER_LENGTH), svc.createDecryptStream(key, header))).rejects.toThrow(
      RecordingDecryptionError,
    );

    const truncated = container.subarray(XREC_HEADER_LENGTH, container.length - 10);
    await expect(collect(truncated, svc.createDecryptStream(key, header))).rejects.toThrow(/truncated/);

    expect(() => svc.decryptFile(randomBytes(32), container)).toThrow(RecordingDecryptionError);

    // Claiming a shorter plaintext (to cut the recording off) breaks every chunk's AAD.
    const shortened = Buffer.from(container);
    shortened.writeBigUInt64BE(BigInt(2048), 12);
    const shortHeader = svc.parseHeader(shortened);
    await expect(
      collect(shortened.subarray(XREC_HEADER_LENGTH, XREC_HEADER_LENGTH + 2 * (1024 + 16)), svc.createDecryptStream(key, shortHeader)),
    ).rejects.toThrow(RecordingDecryptionError);
  });

  it('rejects ranges outside the plaintext and foreign files', () => {
    const container = svc.encryptFile(key, randomBytes(100), 1024);
    const header = svc.parseHeader(container);
    expect(() => svc.ciphertextRange(header, 0, 100)).toThrow(RangeError);
    expect(() => svc.ciphertextRange(header, 50, 10)).toThrow(RangeError);
    expect(() => svc.parseHeader(Buffer.alloc(32))).toThrow(/not an XREC/);
    expect(() => svc.parseHeader(Buffer.alloc(10))).toThrow(/truncated/);
  });
});

// Filled in from the Node side; the python test asserts its encryption yields the same bytes.
const PY_VECTOR_CIPHERTEXT_HEX = '1e84e5dbff9f837ea4a736e17d79c6dcfe0140d3f197ea0edf04';
