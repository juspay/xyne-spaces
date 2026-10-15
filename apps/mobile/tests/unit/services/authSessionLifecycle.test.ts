import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  beginAuthSession,
  beginAuthOperation,
  enqueueAuthCookieMutation,
  enqueueAuthNativeMutation,
  enqueueAuthStoreMutation,
  getAuthSessionGeneration,
  isAuthOperationCurrent,
  isAuthSessionCurrent,
  trackAuthSessionOperation,
  waitForAuthSessionOperations,
} from '@/src/services/authSessionLifecycle';

describe('authSessionLifecycle', (): void => {
  it('invalidates older generations', (): void => {
    const first = getAuthSessionGeneration();
    const second = beginAuthSession();

    assert.equal(second, first + 1);
    assert.equal(isAuthSessionCurrent(first), false);
    assert.equal(isAuthSessionCurrent(second), true);
  });

  it('supersedes an older operation without invalidating the session generation', (): void => {
    const generation = getAuthSessionGeneration();
    const firstOperation = beginAuthOperation();
    const secondOperation = beginAuthOperation();

    assert.equal(getAuthSessionGeneration(), generation);
    assert.equal(isAuthOperationCurrent(firstOperation), false);
    assert.equal(isAuthOperationCurrent(secondOperation), true);
  });

  it('waits for operations started by the invalidated generation', async (): Promise<void> => {
    const generation = getAuthSessionGeneration();
    let resolveOperation: (() => void) | undefined;
    const operation = new Promise<void>(resolve => {
      resolveOperation = resolve;
    });
    const tracked = trackAuthSessionOperation(generation, operation);
    const invalidatedGeneration = beginAuthSession();

    let completed = false;
    const wait = waitForAuthSessionOperations(invalidatedGeneration).then(result => {
      completed = true;
      return result;
    });

    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    resolveOperation?.();
    await tracked;
    assert.equal(await wait, true);
  });

  it('skips a queued protected-store mutation after invalidation', async (): Promise<void> => {
    const staleGeneration = getAuthSessionGeneration();
    beginAuthSession();
    let ran = false;

    await enqueueAuthStoreMutation(staleGeneration, async (): Promise<void> => {
      ran = true;
    });

    assert.equal(ran, false);
  });

  it('bounds a native cookie mutation wait without abandoning serialization', async (): Promise<void> => {
    const generation = getAuthSessionGeneration();
    let release: (() => void) | undefined;
    const nativeOperation = new Promise<void>(resolve => {
      release = resolve;
    });

    await assert.rejects(
      enqueueAuthCookieMutation(
        generation,
        () => nativeOperation,
        () => true,
        5,
      ),
      /timed out after 5ms/,
    );

    let ranAfterNativeSettled = false;
    const queued = enqueueAuthCookieMutation(
      generation,
      () => {
        ranAfterNativeSettled = true;
      },
      () => true,
      100,
    );
    release?.();
    await queued;
    assert.equal(ranAfterNativeSettled, true);
  });

  it('does not let a stalled app-store mutation delay native invalidation', async (): Promise<void> => {
    const generation = getAuthSessionGeneration();
    let releaseStore: (() => void) | undefined;
    const stalledStore = new Promise<void>(resolve => {
      releaseStore = resolve;
    });

    const storeMutation = enqueueAuthStoreMutation(
      generation,
      () => stalledStore,
      () => true,
      5,
    );
    await assert.rejects(storeMutation, /timed out after 5ms/);

    let nativeCleared = false;
    await enqueueAuthNativeMutation(generation, () => {
      nativeCleared = true;
    });
    assert.equal(nativeCleared, true);

    releaseStore?.();
  });
});
