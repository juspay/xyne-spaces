import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeBase64Bytes, decodeBase64Utf8 } from '@/src/utils/base64Utf8';

// ─── decodeBase64Bytes ──────────────────────────────────────────────────────

test('decodeBase64Bytes: empty input yields a zero-length Uint8Array', () => {
  const bytes = decodeBase64Bytes('');
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length, 0);
});

test('decodeBase64Bytes: decodes ASCII bytes exactly', () => {
  // base64("ABC") === "QUJD" → bytes 65,66,67
  assert.deepEqual(Array.from(decodeBase64Bytes('QUJD')), [65, 66, 67]);
});

test('decodeBase64Bytes: decodes multi-byte UTF-8 sequence byte-for-byte', () => {
  // "😀" (U+1F600) encodes to bytes F0 9F 98 80 → base64 "8J+YgA=="
  assert.deepEqual(Array.from(decodeBase64Bytes('8J+YgA==')), [0xf0, 0x9f, 0x98, 0x80]);
});

// ─── decodeBase64Utf8 ───────────────────────────────────────────────────────

test('decodeBase64Utf8: empty input returns empty string', () => {
  assert.equal(decodeBase64Utf8(''), '');
});

test('decodeBase64Utf8: decodes plain ASCII', () => {
  // base64("Hello, World!") === "SGVsbG8sIFdvcmxkIQ=="
  assert.equal(decodeBase64Utf8('SGVsbG8sIFdvcmxkIQ=='), 'Hello, World!');
});

test('decodeBase64Utf8: decodes a 2-byte UTF-8 character', () => {
  // "é" (U+00E9) → bytes C3 A9 → base64 "w6k="
  assert.equal(decodeBase64Utf8('w6k='), 'é');
});

test('decodeBase64Utf8: decodes a 4-byte emoji', () => {
  assert.equal(decodeBase64Utf8('8J+YgA=='), '😀');
});

test('decodeBase64Utf8: round-trips arbitrary UTF-8 content', () => {
  const samples = ['', 'plain ascii', 'café ☕', 'multi\nline\ttext', '日本語 テスト', '👩‍👩‍👧 family'];
  for (const sample of samples) {
    const b64 = Buffer.from(sample, 'utf8').toString('base64');
    assert.equal(decodeBase64Utf8(b64), sample, `round-trip failed for: ${JSON.stringify(sample)}`);
  }
});
