import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

const storeSource = readFileSync(resolve(process.cwd(), 'src/notifications/sos/store.ts'), 'utf8');
const parserSource = readFileSync(
  resolve(process.cwd(), 'src/notifications/sos/parser.ts'),
  'utf8',
);
const hostSource = readFileSync(
  resolve(process.cwd(), 'src/notifications/sos/SosAlertHost.tsx'),
  'utf8',
);
const extensionSource = readFileSync(
  resolve(process.cwd(), 'plugins/notification-service/NotificationService.swift'),
  'utf8',
);
const serviceSource = readFileSync(
  resolve(process.cwd(), 'src/notifications/NotificationService.ts'),
  'utf8',
);
const eventsSource = readFileSync(
  resolve(process.cwd(), 'src/notifications/sos/events.ts'),
  'utf8',
);
const actionsSource = readFileSync(
  resolve(process.cwd(), 'src/notifications/sos/actionsApi.ts'),
  'utf8',
);
const displaySource = readFileSync(
  resolve(process.cwd(), 'src/notifications/sos/display.ts'),
  'utf8',
);

test('SOS state never promotes ownerless pending data across accounts', () => {
  assert.doesNotMatch(storeSource, /getJson<SosAlert\[\]>\(PREAUTH_STORAGE_KEY\)/);
  assert.doesNotMatch(storeSource, /const preAuth|const merged/);
  assert.match(storeSource, /deleteKeys\(\[PREAUTH_STORAGE_KEY, LEGACY_VIEW_INTENT_KEY\]\)/);
  assert.match(storeSource, /const userId = resolveUserId\(\)/);
  assert.match(storeSource, /AUTH_TOKEN_SIGNED_OUT_HANDOFF_KEY/);
  assert.match(storeSource, /ownerUserId: userId/);
});

test('SOS tray recovery requires trusted owner metadata', () => {
  assert.match(parserSource, /ownerUserId/);
  assert.match(hostSource, /alert\?\.ownerUserId === expectedUserId/);
  assert.match(hostSource, /lotus_auth_token_signed_out/);
  assert.doesNotMatch(hostSource, /onNotificationOpenedApp/);
});

test('SOS presentation uses the admitted owner-scoped alert', () => {
  assert.match(serviceSource, /const ownedAlert = addSosAlert\(sosAlert\)/);
  assert.match(serviceSource, /presentSosNotification\(ownedAlert/);
  assert.match(eventsSource, /getOwnedSosAlert\(alert\.id\)/);
  assert.match(eventsSource, /presentSosNotification\(ownedAlert/);
  assert.match(actionsSource, /getOwnedSosAlert\(alert\.id\)/);
  assert.match(actionsSource, /isAuthScopeCurrent\(generation, operation\)/);
  assert.match(displaySource, /isAdmittedSosScope/);
  assert.match(displaySource, /await notifee\.cancelNotification\(alert\.id\)/);
});

test('iOS notification extension refuses ownerless SOS persistence', () => {
  assert.match(extensionSource, /guard let ownerUserId else/);
  assert.match(extensionSource, /NotificationCacheDeleteKey\(/);
  assert.match(extensionSource, /alert\["ownerUserId"\] = ownerUserId/);
  assert.match(extensionSource, /applySosOwnerMetadata/);
  assert.match(extensionSource, /authTokenSignedOutHandoffKey/);
  assert.match(extensionSource, /currentSharedUserId\(\) == ownerUserId/);
  assert.doesNotMatch(extensionSource, /let key = userId\.map/);
});

test('iOS notification extension gates tray handoff and telemetry by privacy-safe state', () => {
  const trayStart = extensionSource.indexOf('private func persistTrayHandoff');
  const trayEnd = extensionSource.indexOf('private func getCertificateIdentity', trayStart);
  const traySource = extensionSource.slice(trayStart, trayEnd);
  assert.match(traySource, /currentSharedUserId\(\)/);
  assert.doesNotMatch(traySource, /Constants\.lotusUserIdKey/);
  assert.doesNotMatch(traySource, /Constants\.globalUserIdKey/);

  const authStart = extensionSource.indexOf('private func getSharedAuthToken');
  const authEnd = extensionSource.indexOf('// The bearer is shared', authStart);
  const authSource = extensionSource.slice(authStart, authEnd);
  assert.match(authSource, /authTokenSignedOutHandoffKey/);
  assert.match(authSource, /authTokenSignedOutState/);

  const contextStart = extensionSource.indexOf('private func observabilityDeviceContext');
  const contextEnd = extensionSource.indexOf('MARK: - Notification v3 tray group', contextStart);
  const contextSource = extensionSource.slice(contextStart, contextEnd);
  assert.doesNotMatch(contextSource, /activeUserEmail|\["email"\]|\["userId"\]|\["workspaceId"\]/);
});
