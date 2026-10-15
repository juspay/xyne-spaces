import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  QueryCacheLogEvent,
  formatUnknownError,
  queryCacheLogError,
} from '@/src/utils/queryCacheLogger';

describe('QueryCacheLogEvent', () => {
  it('declares the known log event names', () => {
    assert.deepEqual(QueryCacheLogEvent, {
      ZERO_RUN_ERROR: 'ZERO_RUN_ERROR',
      APP_REFRESH: 'APP_REFRESH',
    });
  });
});

describe('formatUnknownError', () => {
  it('serialises Error instances with name, message and stack', () => {
    const err = new TypeError('boom');
    const out = formatUnknownError(err);
    assert.equal(out['kind'], 'Error');
    assert.equal(out['name'], 'TypeError');
    assert.equal(out['message'], 'boom');
    assert.equal(typeof out['stack'], 'string');
  });

  it('handles null and undefined as nil', () => {
    assert.deepEqual(formatUnknownError(null), { kind: 'nil', value: 'null' });
    assert.deepEqual(formatUnknownError(undefined), { kind: 'nil', value: 'undefined' });
  });

  it('serialises plain objects as json', () => {
    assert.deepEqual(formatUnknownError({ a: 1 }), { kind: 'json', value: '{"a":1}' });
  });

  it('falls back to object toString on circular structures', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const out = formatUnknownError(circular);
    assert.equal(out['kind'], 'object');
    assert.equal(out['value'], '[object Object]');
  });

  it('describes primitives by their typeof', () => {
    assert.deepEqual(formatUnknownError('nope'), { kind: 'string', value: 'nope' });
    assert.deepEqual(formatUnknownError(42), { kind: 'number', value: '42' });
    assert.deepEqual(formatUnknownError(true), { kind: 'boolean', value: 'true' });
  });
});

describe('queryCacheLogError', () => {
  it('logs the tagged event and metadata to the error console', () => {
    const errorMock = mock.method(console, 'error', () => {});
    try {
      queryCacheLogError('ZERO_RUN_ERROR', { queryId: 'q1' });
      assert.equal(errorMock.mock.calls.length, 1);
      assert.deepEqual(errorMock.mock.calls[0]?.arguments, ['[ZERO_RUN_ERROR]', { queryId: 'q1' }]);
    } finally {
      errorMock.mock.restore();
    }
  });
});
