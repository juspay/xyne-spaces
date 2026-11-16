import type { ExternalSource } from '@prisma/client';
import {
  checkNotificationMailbox,
  decodeGmailNotification,
  handlePulledGmailNotification,
  type PulledNotificationDeps,
} from './pubsubNotification';

const MAILBOX = 'desk@example.com';
const SUBSCRIPTION = 'gmail-google-shared-prod-pull';

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64');
const pulled = (value: unknown, raw?: string) => ({
  id: 'msg-1',
  data: Buffer.from(raw ?? JSON.stringify(value)),
  publishTime: new Date('2026-11-11T10:00:00.000Z'),
});

const source = (overrides: Partial<ExternalSource> = {}): ExternalSource =>
  ({
    id: 'src-1',
    name: 'google-desk--example-com',
    workspaceId: 'ws-1',
    isActive: true,
    credentials: 'encrypted',
    ...overrides,
  }) as ExternalSource;

const makeDeps = (overrides: Partial<PulledNotificationDeps> = {}) => {
  const deps = {
    findSource: jest.fn(async () => source()),
    credentialsEmail: jest.fn(() => MAILBOX),
    ingest: jest.fn(async () => [{ action: 'created' }]),
    ...overrides,
  };
  return deps as typeof deps & PulledNotificationDeps;
};

describe('decodeGmailNotification', () => {
  it('decodes emailAddress and a numeric historyId', () => {
    expect(decodeGmailNotification(encode({ emailAddress: MAILBOX, historyId: 12345 }))).toEqual({
      emailAddress: MAILBOX,
      historyId: '12345',
    });
  });

  it.each([
    ['empty data', ''],
    ['not JSON', Buffer.from('not json').toString('base64')],
    ['no emailAddress', encode({ historyId: '1' })],
    ['no historyId', encode({ emailAddress: MAILBOX })],
  ])('returns null for %s', (_label, data) => {
    expect(decodeGmailNotification(data)).toBeNull();
  });
});

describe('checkNotificationMailbox', () => {
  it('passes the matching mailbox', () => {
    expect(checkNotificationMailbox(encode({ emailAddress: MAILBOX, historyId: '1' }), MAILBOX)).toBeNull();
  });

  it('rejects another mailbox', () => {
    expect(checkNotificationMailbox(encode({ emailAddress: 'other@example.com', historyId: '1' }), MAILBOX))
      .toMatch(/Email mismatch/);
  });
});

describe('handlePulledGmailNotification', () => {
  const data = { emailAddress: MAILBOX, historyId: '777' };

  it('ingests through the push payload shape and acks', async () => {
    const deps = makeDeps();
    const decision = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);

    expect(decision).toMatchObject({ action: 'ack', reason: 'processed', resultCount: 1 });
    expect(deps.findSource).toHaveBeenCalledWith(MAILBOX);
    expect(deps.ingest).toHaveBeenCalledWith(source(), {
      message: { data: encode(data), messageId: 'msg-1', publishTime: '2026-11-11T10:00:00.000Z' },
      subscription: SUBSCRIPTION,
    });
  });

  it('acks a payload that can never be processed', async () => {
    const deps = makeDeps();
    const decision = await handlePulledGmailNotification(pulled(null, 'garbage'), SUBSCRIPTION, deps);
    expect(decision).toMatchObject({ action: 'ack', reason: 'invalid-payload' });
    expect(deps.findSource).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown-source', { findSource: jest.fn(async () => null) }],
    ['inactive-source', { findSource: jest.fn(async () => source({ isActive: false })) }],
    ['credentials-missing-email', { credentialsEmail: jest.fn(() => undefined) }],
    ['email-mismatch', { credentialsEmail: jest.fn(() => 'someone-else@example.com') }],
  ])('acks without ingest: %s', async (reason, overrides) => {
    const deps = makeDeps(overrides as Partial<PulledNotificationDeps>);
    const decision = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);
    expect(decision).toMatchObject({ action: 'ack', reason });
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it.each([
    ['source-lookup-failed', { findSource: jest.fn(async () => { throw new Error('db down'); }) }],
    ['credentials-unreadable', { credentialsEmail: jest.fn(() => { throw new Error('bad key'); }) }],
    ['ingest-failed', { ingest: jest.fn(async () => { throw new Error('gmail 503'); }) }],
  ])('nacks retryable failures: %s', async (reason, overrides) => {
    const deps = makeDeps(overrides as Partial<PulledNotificationDeps>);
    const decision = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);
    expect(decision).toMatchObject({ action: 'nack', reason });
    expect(decision.error).toBeTruthy();
  });

  describe('with a mailbox lock (replicas sharing the subscription)', () => {
    /** In-memory stand-in for the Redis lock and pending flag. */
    const memoryLock = () => {
      const state = { held: false, pending: false };
      const lockDeps = {
        tryAcquire: jest.fn(async () => {
          if (state.held) return null;
          state.held = true;
          return { release: async () => { state.held = false; } };
        }),
        markPending: jest.fn(async () => { state.pending = true; }),
        takePending: jest.fn(async () => {
          const was = state.pending;
          state.pending = false;
          return was;
        }),
      };
      return { state, lockDeps };
    };

    it('ingests once and releases the lock', async () => {
      const { state, lockDeps } = memoryLock();
      const deps = makeDeps({ mailboxLock: lockDeps });
      const decision = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);

      expect(decision).toMatchObject({ action: 'ack', reason: 'processed', resultCount: 1 });
      expect(deps.ingest).toHaveBeenCalledTimes(1);
      expect(state.held).toBe(false);
    });

    it('defers to the worker holding the mailbox: marks it pending and acks without ingest', async () => {
      const { state, lockDeps } = memoryLock();
      state.held = true; // another replica is ingesting this mailbox
      const deps = makeDeps({ mailboxLock: lockDeps });
      const decision = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);

      expect(decision).toMatchObject({ action: 'ack', reason: 'mailbox-busy-deferred' });
      expect(deps.ingest).not.toHaveBeenCalled();
      expect(state.pending).toBe(true);
      expect(lockDeps.tryAcquire).toHaveBeenCalledTimes(2);
    });

    it('takes over when the holder lets go between the two acquire attempts', async () => {
      const { lockDeps } = memoryLock();
      lockDeps.tryAcquire.mockImplementationOnce(async () => null);
      const deps = makeDeps({ mailboxLock: lockDeps });
      const decision = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);

      expect(decision).toMatchObject({ action: 'ack', reason: 'processed', resultCount: 1 });
      expect(deps.ingest).toHaveBeenCalledTimes(1);
    });

    it('makes another pass, from a re-read source, for a change marked during its ingest', async () => {
      const { state, lockDeps } = memoryLock();
      const refreshed = source({ lastSyncCursor: '900' } as Partial<ExternalSource>);
      const findSource = jest.fn(async () => source());
      const ingest = jest.fn(async () => {
        if (ingest.mock.calls.length === 1) state.pending = true; // a deferred notification lands mid-ingest
        return [{ action: 'created' }];
      });
      const deps = makeDeps({ mailboxLock: lockDeps, findSource, ingest });
      findSource.mockResolvedValueOnce(source()).mockResolvedValueOnce(refreshed);

      const decision = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);

      expect(decision).toMatchObject({ action: 'ack', reason: 'processed', resultCount: 2 });
      expect(ingest).toHaveBeenCalledTimes(2);
      expect(ingest.mock.calls[1][0]).toBe(refreshed);
      expect(state).toEqual({ held: false, pending: false });
    });

    it('releases the lock and nacks when ingest fails', async () => {
      const { state, lockDeps } = memoryLock();
      const deps = makeDeps({
        mailboxLock: lockDeps,
        ingest: jest.fn(async () => { throw new Error('gmail 503'); }),
      });
      const decision = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);

      expect(decision).toMatchObject({ action: 'nack', reason: 'ingest-failed' });
      expect(state.held).toBe(false);
    });

    it('nacks after the pass cap if the mailbox is still changing, so the change is retried', async () => {
      const { state, lockDeps } = memoryLock();
      const deps = makeDeps({
        mailboxLock: lockDeps,
        ingest: jest.fn(async () => {
          state.pending = true;
          return [{ action: 'created' }];
        }),
      });
      const decision = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);

      expect(decision).toMatchObject({ action: 'nack', reason: 'mailbox-still-pending', resultCount: 5 });
      expect(deps.ingest).toHaveBeenCalledTimes(5);
      expect(state.held).toBe(false);
    });
  });

  it('hands every redelivery to ingest, which dedupes by cursor and Gmail id', async () => {
    const deps = makeDeps({ ingest: jest.fn(async () => [{ action: 'skipped' }]) });
    await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);
    const second = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);
    expect(second).toMatchObject({ action: 'ack', reason: 'processed' });
    expect(deps.ingest).toHaveBeenCalledTimes(2);
  });
});
