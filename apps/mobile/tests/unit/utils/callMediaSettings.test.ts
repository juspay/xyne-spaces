import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseOptionalBooleanRouteParam,
  readSingleRouteParam,
  resolveInitialCallMediaSettings,
} from '@/src/utils/callMediaSettings';

describe('resolveInitialCallMediaSettings', () => {
  it('enables the camera by default only for video calls', () => {
    assert.deepEqual(resolveInitialCallMediaSettings('VIDEO'), {
      microphoneEnabled: true,
      cameraEnabled: true,
    });
    assert.deepEqual(resolveInitialCallMediaSettings('AUDIO'), {
      microphoneEnabled: true,
      cameraEnabled: false,
    });
  });

  it('lets an explicit request override the defaults', () => {
    assert.deepEqual(resolveInitialCallMediaSettings('VIDEO', { cameraEnabled: false }), {
      microphoneEnabled: true,
      cameraEnabled: false,
    });
    assert.deepEqual(
      resolveInitialCallMediaSettings('AUDIO', { microphoneEnabled: false, cameraEnabled: true }),
      { microphoneEnabled: false, cameraEnabled: true },
    );
  });
});

describe('readSingleRouteParam', () => {
  it('returns a string value as-is', () => {
    assert.equal(readSingleRouteParam('abc'), 'abc');
  });

  it('returns the first element of an array', () => {
    assert.equal(readSingleRouteParam(['first', 'second']), 'first');
  });

  it('returns undefined for undefined or an empty array', () => {
    assert.equal(readSingleRouteParam(undefined), undefined);
    assert.equal(readSingleRouteParam([]), undefined);
  });
});

describe('parseOptionalBooleanRouteParam', () => {
  it('parses case-insensitive, trimmed boolean strings', () => {
    assert.equal(parseOptionalBooleanRouteParam('true'), true);
    assert.equal(parseOptionalBooleanRouteParam('TRUE'), true);
    assert.equal(parseOptionalBooleanRouteParam('  false '), false);
    assert.equal(parseOptionalBooleanRouteParam(['true']), true);
  });

  it('returns undefined for non-boolean or missing values', () => {
    assert.equal(parseOptionalBooleanRouteParam('yes'), undefined);
    assert.equal(parseOptionalBooleanRouteParam(''), undefined);
    assert.equal(parseOptionalBooleanRouteParam(undefined), undefined);
  });
});
