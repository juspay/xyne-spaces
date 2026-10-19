import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

const setupSource = readFileSync(
  resolve(process.cwd(), 'src/notifications/display/notificationSetup.ts'),
  'utf8',
);
const displaySource = readFileSync(
  resolve(process.cwd(), 'src/notifications/display/presentNotification.ts'),
  'utf8',
);
const sosSource = readFileSync(resolve(process.cwd(), 'src/notifications/sos/display.ts'), 'utf8');

test('ordinary Android notification channels default to private lock-screen visibility', () => {
  assert.equal((setupSource.match(/visibility: AndroidVisibility\.PRIVATE/g) || []).length, 3);
  assert.equal((setupSource.match(/visibility: AndroidVisibility\.PUBLIC/g) || []).length, 1);
});

test('Android message and reminder notifications are private on secure lock screens', () => {
  assert.equal((displaySource.match(/visibility: AndroidVisibility\.PRIVATE/g) || []).length, 3);
  assert.doesNotMatch(displaySource, /visibility: AndroidVisibility\.(PUBLIC|SECRET)/);
  assert.equal((displaySource.match(/category: AndroidCategory\.MESSAGE/g) || []).length, 2);
  assert.equal((displaySource.match(/category: AndroidCategory\.REMINDER/g) || []).length, 1);
});

test('notify-kit patch shows a generic placeholder instead of private content on the lock screen', () => {
  const patch = readFileSync(
    resolve(process.cwd(), 'patches/react-native-notify-kit+10.5.0.patch'),
    'utf8',
  );
  assert.match(patch, /\+\s+builder\.setPublicVersion\(publicBuilder\.build\(\)\);/);
  assert.match(patch, /VISIBILITY_PRIVATE\) return null;/);
  assert.match(patch, /CATEGORY_MESSAGE\.equals\(category\)\) return "New message";/);
  assert.match(patch, /CATEGORY_REMINDER\.equals\(category\)\) return "New reminder";/);
  // The placeholder never copies the title, body or large icon of the real notification.
  const publicBlock = patch.slice(
    patch.indexOf('publicBuilder ='),
    patch.indexOf('setPublicVersion'),
  );
  assert.doesNotMatch(publicBlock, /notificationModel\.get(Title|Body|SubTitle)|LargeIcon/);
});

test('iOS message previews use a generic placeholder when previews are disabled', () => {
  assert.match(setupSource, /hiddenPreviewsShowTitle: false/);
  assert.match(setupSource, /hiddenPreviewsShowSubtitle: false/);
  assert.match(setupSource, /hiddenPreviewsBodyPlaceholder: 'New Xyne Spaces message'/);
});

test('SOS notification remains explicitly public for emergency behavior', () => {
  assert.match(sosSource, /visibility: AndroidVisibility\.PUBLIC/);
  assert.doesNotMatch(sosSource, /visibility: AndroidVisibility\.PRIVATE/);
});
