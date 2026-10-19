import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

// Source-boundary regression checks only: real Keychain access groups,
// accessibility, and concurrent NSE reads still require a signed-device test.
const keychainSource = readFileSync(
  resolve(process.cwd(), 'plugins/ios-modules/SharedAuthTokenKeychain.swift'),
  'utf8',
);
const extensionSource = readFileSync(
  resolve(process.cwd(), 'plugins/notification-service/NotificationService.swift'),
  'utf8',
);

describe('iOS protected background auth handoff', () => {
  it('updates existing credentials without deleting the shared item during refresh', () => {
    const start = keychainSource.indexOf('static func write(token: String) throws');
    const end = keychainSource.indexOf('static func read()', start);
    assert.ok(start >= 0 && end > start);
    const write = keychainSource.slice(start, end);

    assert.match(write, /SecItemUpdate\(baseQuery as CFDictionary, attributes as CFDictionary\)/);
    assert.doesNotMatch(write, /SecItemDelete/);
    assert.match(write, /if updateStatus == errSecSuccess \{ return \}/);
    const notFoundGuard = write.indexOf('guard updateStatus == errSecItemNotFound else');
    const insert = write.indexOf('SecItemAdd(');
    assert.ok(notFoundGuard >= 0 && insert > notFoundGuard);
    assert.match(write.slice(notFoundGuard, insert), /throw NSError/);
    assert.match(write, /guard status == errSecSuccess else/);
    assert.match(write, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  });

  it('retains explicit logout deletion and no plaintext extension token fallback', () => {
    const clear = keychainSource.slice(keychainSource.indexOf('static func clear()'));
    assert.match(clear, /SecItemDelete\(baseQuery as CFDictionary\)/);
    assert.match(clear, /status == errSecSuccess \|\| status == errSecItemNotFound/);
    assert.match(extensionSource, /SharedAuthTokenKeychain\.read\(\)/);
    assert.doesNotMatch(extensionSource, /xyne-global:authToken|lotus_auth_token(?!_signed_out)/);
  });

  it('blocks shared-keychain reads after the logout tombstone is recorded', () => {
    const readStart = extensionSource.indexOf('private func getSharedAuthToken()');
    const readEnd = extensionSource.indexOf('private func isMMKVAvailable()', readStart);
    assert.ok(readStart >= 0 && readEnd > readStart);
    const reader = extensionSource.slice(readStart, readEnd);
    assert.match(reader, /authTokenSignedOutHandoffKey/);
    assert.match(reader, /authTokenSignedOutState/);
    assert.match(reader, /return nil/);
    assert.ok(reader.indexOf('return nil') < reader.indexOf('SharedAuthTokenKeychain.read()'));
  });
});
