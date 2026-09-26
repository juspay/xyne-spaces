import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose: this is exactly the module consumers
// resolve, so a mismatch between src and the published dist shows up here too.
// Run via `pnpm --filter @xyne/shared test` (builds first).
import {
  EncryptionKeyRingConfigError,
  parseEncryptionKeyRing,
} from '../dist/server/encryption-key-ring.js';

const K1_HEX = 'ab'.repeat(32);
const K2_HEX = 'cd'.repeat(32);

function ring(entries) {
  return JSON.stringify(entries);
}

function expectConfigError(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof EncryptionKeyRingConfigError,
      `expected EncryptionKeyRingConfigError, got ${error}`
    );
    return error;
  }
  throw new Error('expected parseEncryptionKeyRing to throw');
}

test('malformed JSON → keyring_json_invalid', () => {
  const error = expectConfigError(() =>
    parseEncryptionKeyRing('not-json')
  );
  assert.equal(error.reason, 'keyring_json_invalid');
});

test('non-array JSON → keyring_validation_failed', () => {
  const error = expectConfigError(() =>
    parseEncryptionKeyRing('{}')
  );
  assert.equal(error.reason, 'keyring_validation_failed');
});

test('empty array → keyring_validation_failed', () => {
  const error = expectConfigError(() =>
    parseEncryptionKeyRing('[]')
  );
  assert.equal(error.reason, 'keyring_validation_failed');
});

test('duplicate IDs are rejected', () => {
  const error = expectConfigError(() =>
    parseEncryptionKeyRing(
      ring([
        { id: 'k1', key: K1_HEX },
        { id: 'k1', key: K2_HEX },
      ])
    )
  );
  assert.equal(error.reason, 'keyring_validation_failed');
  assert.match(error.message, /Duplicate key ID/);
});

test('reserved IDs are rejected', () => {
  for (const id of ['legacy', 'v2']) {
    const error = expectConfigError(() =>
      parseEncryptionKeyRing(ring([{ id, key: K1_HEX }]))
    );
    assert.equal(error.reason, 'keyring_validation_failed');
  }
});

test('invalid ID format is rejected', () => {
  const error = expectConfigError(() =>
    parseEncryptionKeyRing(
      ring([{ id: 'bad id!', key: K1_HEX }])
    )
  );
  assert.equal(error.reason, 'keyring_validation_failed');
});

test('missing ID is rejected', () => {
  const error = expectConfigError(() =>
    parseEncryptionKeyRing(ring([{ key: K1_HEX }]))
  );
  assert.equal(error.reason, 'keyring_validation_failed');
});

test('missing key is rejected', () => {
  const error = expectConfigError(() =>
    parseEncryptionKeyRing(ring([{ id: 'k1' }]))
  );
  assert.equal(error.reason, 'keyring_validation_failed');
});

test('non-hexadecimal key is rejected without echoing it', () => {
  const badKey = 'zz'.repeat(32);
  const error = expectConfigError(() =>
    parseEncryptionKeyRing(ring([{ id: 'k1', key: badKey }]))
  );
  assert.equal(error.reason, 'keyring_validation_failed');
  assert.ok(
    !error.message.includes(badKey),
    `error message must not contain the raw key: ${error.message}`
  );
});

test('wrong key length is rejected', () => {
  const error = expectConfigError(() =>
    parseEncryptionKeyRing(
      ring([{ id: 'k1', key: 'ab'.repeat(16) }])
    )
  );
  assert.equal(error.reason, 'keyring_validation_failed');
});

test('whitespace around a valid key is normalized', () => {
  const { keys } = parseEncryptionKeyRing(
    ring([{ id: 'k1', key: `  ${K1_HEX}  ` }])
  );
  assert.deepEqual(
    keys.get('k1'),
    Buffer.from(K1_HEX, 'hex')
  );
});

test('valid ring returns every reader key in order', () => {
  const { keys } = parseEncryptionKeyRing(
    ring([
      { id: 'k1', key: K1_HEX },
      { id: 'k2', key: K2_HEX },
    ])
  );
  assert.deepEqual([...keys.keys()], ['k1', 'k2']);
  assert.deepEqual(keys.get('k2'), Buffer.from(K2_HEX, 'hex'));
});
