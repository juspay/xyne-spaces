import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveFallbackHydratedQueryArgs,
  withFallbackHydratedQueryArgs,
} from '@/src/hooks/with-fallback-hydrated-query-args';

describe('resolveFallbackHydratedQueryArgs', () => {
  it('maps the fallback-hook watermark onto updatedAt', () => {
    assert.deepEqual(resolveFallbackHydratedQueryArgs({ lastUpdatedAt: 1700 }), {
      updatedAt: 1700,
    });
  });

  it('keeps an explicit updatedAt (compatible query path)', () => {
    assert.deepEqual(resolveFallbackHydratedQueryArgs({ updatedAt: 9, lastUpdatedAt: 1700 }), {
      updatedAt: 9,
      lastUpdatedAt: 1700,
    });
  });

  it('leaves a full-catalog request untouched', () => {
    assert.equal(resolveFallbackHydratedQueryArgs(undefined), undefined);
    assert.deepEqual(resolveFallbackHydratedQueryArgs({}), {});
  });
});

describe('withFallbackHydratedQueryArgs', () => {
  it('translates the fallback-to-live delta so the query sees updatedAt', () => {
    const received: unknown[] = [];
    const request = withFallbackHydratedQueryArgs({
      args: {},
      query: {
        fn: ({ args }: { ctx: unknown; args?: unknown }) => {
          received.push(args);
          return args;
        },
      },
    });

    request.query.fn({ ctx: {}, args: request.args });
    request.query.fn({ ctx: {}, args: { lastUpdatedAt: 1700 } });

    assert.deepEqual(received, [{}, { updatedAt: 1700 }]);
  });
});
