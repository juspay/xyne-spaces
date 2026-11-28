import { randomBytes } from 'crypto';
import {
  completionProofMessage,
  decryptLiveObject,
  encryptLiveObject,
  liveChunkAad,
  liveVideoChunkAad,
  manifestAad,
  RecordingDecryptionError,
} from './agentRecordingCrypto';

// Same vector as python-agent/tests/test_recording_crypto.py: key 0x07*32, nonce 0x01*12.
const PY_VECTOR_CIPHERTEXT_HEX = '1e84e5dbff9f837ea4a736e17d79c6dcfe0140d3f197ea0edf04';

describe('agent recording objects (chunks and manifests)', () => {
  const key = randomBytes(32);
  const session = '0123456789abcdef';

  it('round-trips and is bound to recording, session, track and position', () => {
    const aad = liveChunkAad('rec-1', session, 2, 5);
    const blob = encryptLiveObject(key, aad, Buffer.from('ogg bytes'));
    expect(decryptLiveObject(key, aad, blob).toString()).toBe('ogg bytes');
    for (const other of [
      liveChunkAad('rec-2', session, 2, 5),
      liveChunkAad('rec-1', 'fedcba9876543210', 2, 5),
      liveChunkAad('rec-1', session, 3, 5),
      liveChunkAad('rec-1', session, 2, 6),
      liveVideoChunkAad('rec-1', session, 2, 5),
      manifestAad('rec-1', session),
    ]) {
      expect(() => decryptLiveObject(key, other, blob)).toThrow(RecordingDecryptionError);
    }
  });

  it('keeps video chunks apart from audio chunks', () => {
    const aad = liveVideoChunkAad('rec-1', session, 0, 3);
    const blob = encryptLiveObject(key, aad, Buffer.from('ts bytes'));
    expect(decryptLiveObject(key, aad, blob).toString()).toBe('ts bytes');
    expect(() => decryptLiveObject(key, liveChunkAad('rec-1', session, 0, 3), blob)).toThrow(RecordingDecryptionError);
    expect(() => decryptLiveObject(key, liveVideoChunkAad('rec-1', session, 0, 4), blob)).toThrow(RecordingDecryptionError);
  });

  it('rejects tampering, truncation, the wrong key and unknown versions', () => {
    const aad = manifestAad('rec-1', session);
    const blob = encryptLiveObject(key, aad, Buffer.from('{"v":1}'));
    const flipped = Buffer.from(blob);
    flipped[20] ^= 1;
    expect(() => decryptLiveObject(key, aad, flipped)).toThrow(RecordingDecryptionError);
    expect(() => decryptLiveObject(key, aad, blob.subarray(0, 20))).toThrow(RecordingDecryptionError);
    expect(() => decryptLiveObject(randomBytes(32), aad, blob)).toThrow(RecordingDecryptionError);
    const v2 = Buffer.from(blob);
    v2[0] = 2;
    expect(() => decryptLiveObject(key, aad, v2)).toThrow(/version 2/);
  });

  it('decrypts the cross-language vector the python agent tests against', () => {
    const blob = Buffer.from('01' + '010101010101010101010101' + PY_VECTOR_CIPHERTEXT_HEX, 'hex');
    expect(decryptLiveObject(Buffer.alloc(32, 7), liveChunkAad('rec-vector', session, 2, 5), blob).toString()).toBe('hello opus');
  });

  it('builds the completion proof message the agent signs', () => {
    expect(completionProofMessage('rec-1', session).toString()).toBe(`xyne-rec-complete:v1|rec-1|${session}`);
  });
});
