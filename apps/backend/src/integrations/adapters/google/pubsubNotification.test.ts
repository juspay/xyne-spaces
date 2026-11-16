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

  it('hands every redelivery to ingest, which dedupes by cursor and Gmail id', async () => {
    const deps = makeDeps({ ingest: jest.fn(async () => [{ action: 'skipped' }]) });
    await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);
    const second = await handlePulledGmailNotification(pulled(data), SUBSCRIPTION, deps);
    expect(second).toMatchObject({ action: 'ack', reason: 'processed' });
    expect(deps.ingest).toHaveBeenCalledTimes(2);
  });
});
