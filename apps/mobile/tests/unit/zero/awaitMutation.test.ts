import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { awaitMutation, subscribeMutationRestore } from '@/src/zero/awaitMutation';
import type { PromiseWithServerResult } from '@rocicorp/zero';

type ResultLike = { type: string; error?: unknown };

const makeMutation = (
  client: ResultLike | Promise<ResultLike>,
  server: ResultLike | Promise<ResultLike>,
): PromiseWithServerResult =>
  ({
    client: Promise.resolve(client),
    server: Promise.resolve(server),
  }) as unknown as PromiseWithServerResult;

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('awaitMutation', () => {
  it('resolves when both client and server succeed', async () => {
    await assert.doesNotReject(
      awaitMutation(makeMutation({ type: 'success' }, { type: 'success' })),
    );
  });

  it('swallows a transient (zero) client error without throwing', async () => {
    await assert.doesNotReject(
      awaitMutation(makeMutation({ type: 'error', error: { type: 'zero' } }, { type: 'success' })),
    );
  });

  it('throws AppMutationError with the message on a non-transient client error', async () => {
    await assert.rejects(
      awaitMutation(
        makeMutation(
          { type: 'error', error: { type: 'app', message: 'client rejected' } },
          {
            type: 'success',
          },
        ),
      ),
      (err: Error) => {
        assert.equal(err.name, 'AppMutationError');
        assert.equal(err.message, 'client rejected');
        return true;
      },
    );
  });

  it('swallows a transient server error after a successful client apply', async () => {
    await assert.doesNotReject(
      awaitMutation(makeMutation({ type: 'success' }, { type: 'error', error: { type: 'zero' } })),
    );
  });

  it('throws on a non-transient server error', async () => {
    await assert.rejects(
      awaitMutation(
        makeMutation(
          { type: 'success' },
          {
            type: 'error',
            error: { type: 'app', message: 'server denied' },
          },
        ),
      ),
      (err: Error) => {
        assert.equal(err.name, 'AppMutationError');
        assert.equal(err.message, 'server denied');
        return true;
      },
    );
  });

  it('falls back to String(error) when the error has no message', async () => {
    await assert.rejects(
      awaitMutation(makeMutation({ type: 'error', error: 'boom' }, { type: 'success' })),
      (err: Error) => {
        assert.equal(err.message, 'boom');
        return true;
      },
    );
  });
});

describe('subscribeMutationRestore', () => {
  it('does not restore when the mutation fully succeeds and reports ok', async () => {
    let restored = 0;
    const settled: string[] = [];
    subscribeMutationRestore(
      makeMutation({ type: 'success' }, { type: 'success' }),
      () => {
        restored += 1;
      },
      result => settled.push(result),
    );
    await flush();
    assert.equal(restored, 0);
    assert.deepEqual(settled, ['ok']);
  });

  it('restores once and reports app-error on a non-transient client error', async () => {
    let restored = 0;
    const settled: string[] = [];
    subscribeMutationRestore(
      makeMutation({ type: 'error', error: { type: 'app', message: 'x' } }, { type: 'success' }),
      () => {
        restored += 1;
      },
      result => settled.push(result),
    );
    await flush();
    assert.equal(restored, 1);
    assert.deepEqual(settled, ['app-error']);
  });

  it('never restores for a transient client error and does not call onSettled', async () => {
    let restored = 0;
    const settled: string[] = [];
    subscribeMutationRestore(
      makeMutation({ type: 'error', error: { type: 'zero' } }, { type: 'success' }),
      () => {
        restored += 1;
      },
      result => settled.push(result),
    );
    await flush();
    assert.equal(restored, 0);
    assert.deepEqual(settled, []);
  });

  it('restores at most once when both halves report a non-transient error', async () => {
    let restored = 0;
    subscribeMutationRestore(
      makeMutation(
        { type: 'error', error: { type: 'app', message: 'c' } },
        { type: 'error', error: { type: 'app', message: 's' } },
      ),
      () => {
        restored += 1;
      },
    );
    await flush();
    assert.equal(restored, 1);
  });

  it('restores and reports app-error when the client promise rejects', async () => {
    let restored = 0;
    const settled: string[] = [];
    const mutation = {
      client: Promise.reject(new Error('rejected')),
      server: Promise.resolve({ type: 'success' }),
    } as unknown as PromiseWithServerResult;
    subscribeMutationRestore(
      mutation,
      () => {
        restored += 1;
      },
      result => settled.push(result),
    );
    await flush();
    assert.equal(restored, 1);
    assert.deepEqual(settled, ['app-error']);
  });

  it('does not restore when the server error is transient', async () => {
    let restored = 0;
    subscribeMutationRestore(
      makeMutation({ type: 'success' }, { type: 'error', error: { type: 'zero' } }),
      () => {
        restored += 1;
      },
    );
    await flush();
    assert.equal(restored, 0);
  });
});
