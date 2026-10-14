import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_SOUND_ID,
  NOTIFICATION_SOUND_OPTIONS,
  androidChannelIdFor,
  iosSoundFor,
  isKnownSoundId,
} from '@/src/notifications/soundMetadata';

describe('soundMetadata options', () => {
  it('offers the default, bell, and string choices', () => {
    assert.deepEqual(
      NOTIFICATION_SOUND_OPTIONS.map(option => option.id),
      ['default', 'bell', 'string'],
    );
  });

  it('defaults to the string sound', () => {
    assert.equal(DEFAULT_SOUND_ID, 'string');
    assert.equal(isKnownSoundId(DEFAULT_SOUND_ID), true);
  });
});

describe('isKnownSoundId', () => {
  it('accepts every advertised sound id', () => {
    for (const option of NOTIFICATION_SOUND_OPTIONS) {
      assert.equal(isKnownSoundId(option.id), true);
    }
  });

  it('rejects unknown strings and non-string values', () => {
    assert.equal(isKnownSoundId('chime'), false);
    assert.equal(isKnownSoundId(''), false);
    assert.equal(isKnownSoundId(123), false);
    assert.equal(isKnownSoundId(null), false);
    assert.equal(isKnownSoundId(undefined), false);
  });
});

describe('iosSoundFor', () => {
  it('passes through the system default and suffixes named sounds with .caf', () => {
    assert.equal(iosSoundFor('default'), 'default');
    assert.equal(iosSoundFor('bell'), 'bell.caf');
    assert.equal(iosSoundFor('string'), 'string.caf');
  });
});

describe('androidChannelIdFor', () => {
  it('uses the base channel for the default sound', () => {
    assert.equal(androidChannelIdFor('default', 'messages'), 'messages');
  });

  it('derives a per-sound channel for named sounds', () => {
    assert.equal(androidChannelIdFor('bell', 'messages'), 'messages__bell');
    assert.equal(androidChannelIdFor('string', 'calls'), 'calls__string');
  });
});
