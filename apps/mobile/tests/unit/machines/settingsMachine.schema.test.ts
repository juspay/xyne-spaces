import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULTS,
  SCHEMA_VERSION,
  SettingsSchema,
  migrators,
} from '@/src/machines/settingsMachine.schema';

describe('SettingsSchema defaults', () => {
  it('fills every section with its documented default', () => {
    assert.deepEqual(DEFAULTS, {
      appearance: { reduceMotion: false, haptics: true },
      chatTheme: { bubbleColorVar: '--color-chat-message-bubble-1' },
      notifications: { sound: true, soundId: 'string', preview: 'always' },
      developers: {
        showConversationComposerBoundaries: false,
        showMessageComposerBoundaries: false,
      },
    });
  });

  it('parses an empty object into the full defaults', () => {
    assert.deepEqual(SettingsSchema.parse({}), DEFAULTS);
  });

  it('merges partial input over defaults without dropping other sections', () => {
    const parsed = SettingsSchema.parse({ appearance: { haptics: false } });
    assert.equal(parsed.appearance.haptics, false);
    assert.equal(parsed.appearance.reduceMotion, false);
    assert.equal(parsed.notifications.soundId, 'string');
  });

  it('rejects values outside the declared enums', () => {
    assert.equal(
      SettingsSchema.safeParse({ chatTheme: { bubbleColorVar: 'neon' } }).success,
      false,
    );
    assert.equal(
      SettingsSchema.safeParse({ notifications: { preview: 'sometimes' } }).success,
      false,
    );
  });
});

describe('settings migrators', () => {
  it('pins the current schema version', () => {
    assert.equal(SCHEMA_VERSION, 2);
  });

  it('v1→v2 rewrites the device-default sound to the new app default', () => {
    const migrateV1 = migrators[1];
    assert.ok(migrateV1);
    const migrated = migrateV1({ notifications: { soundId: 'default', preview: 'always' } });
    assert.deepEqual(migrated, {
      notifications: { soundId: 'string', preview: 'always' },
    });
  });

  it('v1→v2 leaves an explicitly chosen sound untouched', () => {
    const migrateV1 = migrators[1];
    assert.ok(migrateV1);
    const input = { notifications: { soundId: 'bell' } };
    assert.deepEqual(migrateV1(input), input);
  });

  it('v1→v2 is a no-op for non-object or notifications-less input', () => {
    const migrateV1 = migrators[1];
    assert.ok(migrateV1);
    assert.equal(migrateV1(null), null);
    assert.equal(migrateV1('x'), 'x');
    const noNotifications = { appearance: { reduceMotion: false } };
    assert.deepEqual(migrateV1(noNotifications), noNotifications);
  });
});
