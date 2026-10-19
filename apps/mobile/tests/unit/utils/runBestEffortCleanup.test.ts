import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { runBestEffortCleanup, summarizeAuthCleanup } from '@/src/utils/runBestEffortCleanup';

describe('runBestEffortCleanup', (): void => {
  it('continues through every cleanup stage after failures', async (): Promise<void> => {
    const calls: string[] = [];
    const errors: Array<{ stage: string; error: unknown }> = [];
    const cookieError = new Error('cookie cleanup failed');
    const secureStoreError = new Error('secure store cleanup failed');

    await runBestEffortCleanup(
      [
        {
          stage: 'cookies',
          run: (): void => {
            calls.push('cookies');
            throw cookieError;
          },
        },
        {
          stage: 'mmkv_auth',
          run: (): void => {
            calls.push('mmkv_auth');
          },
        },
        {
          stage: 'secure_store',
          run: async (): Promise<void> => {
            calls.push('secure_store');
            throw secureStoreError;
          },
        },
        {
          stage: 'in_memory_state',
          run: (): void => {
            calls.push('in_memory_state');
          },
        },
      ],
      (stage, error): void => {
        errors.push({ stage, error });
      },
    );

    assert.deepEqual(calls, ['cookies', 'mmkv_auth', 'secure_store', 'in_memory_state']);
    assert.deepEqual(errors, [
      { stage: 'cookies', error: cookieError },
      { stage: 'secure_store', error: secureStoreError },
    ]);
  });

  it('continues when failure reporting itself throws', async (): Promise<void> => {
    const calls: string[] = [];

    await runBestEffortCleanup(
      [
        {
          stage: 'delete_mmkv_user_id',
          run: (): void => {
            calls.push('delete_mmkv_user_id');
            throw new Error('MMKV user id deletion failed');
          },
        },
        {
          stage: 'delete_mmkv_auth_token',
          run: (): void => {
            calls.push('delete_mmkv_auth_token');
          },
        },
        {
          stage: 'clear_in_memory_auth',
          run: (): void => {
            calls.push('clear_in_memory_auth');
          },
        },
      ],
      (): never => {
        throw new Error('logger failed');
      },
    );

    assert.deepEqual(calls, [
      'delete_mmkv_user_id',
      'delete_mmkv_auth_token',
      'clear_in_memory_auth',
    ]);
  });

  it('returns per-stage results and skips remaining work when shouldRun is false', async (): Promise<void> => {
    const results = await runBestEffortCleanup(
      [
        {
          stage: 'mark_protected_auth_token_signed_out',
          run: (): void => undefined,
        },
        {
          stage: 'wait_for_auth_operations',
          run: async (): Promise<void> => {
            throw new Error('Pending share cleanup timed out');
          },
        },
        {
          stage: 'delete_protected_auth_token',
          run: (): void => undefined,
        },
        {
          stage: 'clear_in_memory_auth',
          run: (): void => undefined,
        },
      ],
      (): void => undefined,
      (): boolean => true,
    );

    assert.deepEqual(
      results.map(result => result.status),
      ['completed', 'timed_out', 'completed', 'completed'],
    );

    let remainingAllowed = true;
    const skipped = await runBestEffortCleanup(
      [
        {
          stage: 'delete_mmkv_user_id',
          run: (): void => {
            remainingAllowed = false;
          },
        },
        {
          stage: 'clear_global_auth_token',
          run: (): void => undefined,
        },
        {
          stage: 'clear_in_memory_auth',
          run: (): void => undefined,
        },
      ],
      (): void => undefined,
      (): boolean => remainingAllowed,
    );

    assert.deepEqual(skipped, [
      { stage: 'delete_mmkv_user_id', status: 'completed' },
      { stage: 'clear_global_auth_token', status: 'skipped' },
      { stage: 'clear_in_memory_auth', status: 'skipped' },
    ]);
  });

  it('summarizes local invalidation, deletion, and remote revocation', (): void => {
    const summary = summarizeAuthCleanup(
      [
        { stage: 'mark_protected_auth_token_signed_out_before_remote_logout', status: 'completed' },
        { stage: 'delete_protected_auth_token_before_remote_logout', status: 'completed' },
        { stage: 'clear_global_auth_token', status: 'completed' },
        { stage: 'delete_mmkv_user_id', status: 'failed' },
        { stage: 'clear_cookies', status: 'timed_out' },
      ],
      {
        remoteRevocationConfirmed: false,
        remoteRevocationAttempted: true,
      },
    );

    assert.equal(summary.localInvalidationCompleted, true);
    assert.equal(summary.localDeletionAttempted, true);
    assert.equal(summary.localDeletionConfirmed, false);
    assert.equal(summary.remoteRevocationConfirmed, false);
    assert.equal(summary.failedOrTimedOut, true);
  });

  it('does not treat skipped credential deletion as confirmed', (): void => {
    const summary = summarizeAuthCleanup(
      [
        { stage: 'mark_protected_auth_token_signed_out', status: 'completed' },
        { stage: 'delete_mmkv_user_id', status: 'completed' },
        { stage: 'delete_protected_auth_token', status: 'skipped' },
        { stage: 'clear_in_memory_auth', status: 'skipped' },
      ],
      {
        remoteRevocationConfirmed: true,
        remoteRevocationAttempted: true,
      },
    );

    assert.equal(summary.localInvalidationCompleted, true);
    assert.equal(summary.localDeletionAttempted, true);
    assert.equal(summary.localDeletionConfirmed, false);
    assert.equal(summary.remoteRevocationConfirmed, true);
    assert.equal(summary.failedOrTimedOut, false);
  });
});

describe('AuthContext cleanup reporting', (): void => {
  it('logs structured cleanup results without changing signOut()', (): void => {
    const authSource = readFileSync(resolve(process.cwd(), 'src/contexts/AuthContext.tsx'), 'utf8');
    assert.match(authSource, /const signOut = async \(\): Promise<void> => \{/);
    assert.match(authSource, /summarizeAuthCleanup\(/);
    assert.match(authSource, /stage: 'signout_cleanup_summary'/);
    assert.match(authSource, /localInvalidationCompleted: summary\.localInvalidationCompleted/);
    assert.match(authSource, /localDeletionAttempted: summary\.localDeletionAttempted/);
    assert.match(authSource, /localDeletionConfirmed: summary\.localDeletionConfirmed/);
    assert.match(authSource, /remoteRevocationConfirmed: summary\.remoteRevocationConfirmed/);
    assert.match(authSource, /failedOrTimedOut: summary\.failedOrTimedOut/);
    assert.match(authSource, /stage: 'clear_logger_email'/);
    assert.doesNotMatch(
      authSource,
      /void runBestEffortCleanup\([\s\S]*stage: 'clear_logger_email'/,
    );
    assert.match(authSource, /clearMtlsAttachmentCache\(\)/);
    assert.match(authSource, /ATTACHMENT_CACHE_NONCE_KEY/);
  });
});
