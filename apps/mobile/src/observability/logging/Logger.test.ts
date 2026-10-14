import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Clock } from './clock/Clock';
import { Logger } from './Logger';
import type { LogEntry, DefineLogEventMap, LogFields } from './types';
import type { LogTransport } from './transports/LogTransport';
import { MemoryTransport } from './transports/MemoryTransport';
import { InMemoryLogContextStore } from './context/InMemoryLogContextStore';
import { toRemoteLogRecord } from './remote/toRemoteLogRecord';

type TestLogEventMap = DefineLogEventMap<
  Readonly<{
    'auth.login.started': undefined;

    'auth.login.succeeded': Readonly<{
      provider: 'google' | 'microsoft' | 'email';
      durationMs: number;
    }>;

    'auth.login.failed': Readonly<{
      error: unknown;
    }>;

    app_started: undefined;

    'cache.inspected': undefined;

    'network.request.retrying': Readonly<{
      attempt: number;
    }>;

    'operation.failed': Readonly<{
      error: unknown;
    }>;

    'request.started': undefined;
    'request.retrying': undefined;
    'request.failed': undefined;

    'normalization.example': LogFields;
    'normalization.getter_example': LogFields;
    'normalization.limits': LogFields;

    'security.redaction.example': LogFields;
  }>
>;

const FIXED_TIMESTAMP = '2026-08-14T10:30:00.000Z';

const fixedClock: Clock = {
  now: () => new Date(FIXED_TIMESTAMP),
};

class ThrowingTransport implements LogTransport {
  readonly name = 'throwing';

  write(_entry: LogEntry): void {
    throw new Error('Intentional transport failure');
  }
}

describe('Logger', () => {
  it('creates and delivers a structured log entry', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    logger.info('auth.login.succeeded', {
      provider: 'google',
      durationMs: 450,
    });

    const entries = memoryTransport.getEntries();

    assert.equal(entries.length, 1);

    const [entry] = entries;

    assert.ok(entry);
    assert.equal(entry.timestamp, FIXED_TIMESTAMP);
    assert.equal(entry.level, 'info');
    assert.equal(entry.event, 'auth.login.succeeded');
    assert.deepEqual(entry.fields, {
      provider: 'google',
      durationMs: 450,
    });
  });

  it('isolates a failing transport and continues delivery', testContext => {
    const consoleErrorMock = testContext.mock.method(console, 'error', () => {});

    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [new ThrowingTransport(), memoryTransport],
    });

    assert.doesNotThrow(() => {
      logger.warn('network.request.retrying', {
        attempt: 2,
      });
    });

    const entries = memoryTransport.getEntries();

    assert.equal(entries.length, 1);
    assert.equal(consoleErrorMock.mock.callCount(), 1);
  });

  it('delivers only entries that meet the minimum level', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'warn',
      transports: [memoryTransport],
    });

    logger.debug('cache.inspected');
    logger.info('request.started');
    logger.warn('request.retrying');
    logger.error('request.failed');

    const entries = memoryTransport.getEntries();

    assert.deepEqual(
      entries.map(entry => entry.event),
      ['request.retrying', 'request.failed'],
    );
  });

  it('does not read the clock for a filtered entry', () => {
    let clockReadCount = 0;

    const countingClock: Clock = {
      now: () => {
        clockReadCount += 1;
        return new Date(FIXED_TIMESTAMP);
      },
    };

    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: countingClock,
      minimumLevel: 'info',
      transports: [memoryTransport],
    });

    logger.debug('cache.inspected');

    assert.equal(clockReadCount, 0);
    assert.equal(memoryTransport.getEntries().length, 0);
  });

  it('adds context to every entry created by a contextual logger', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    const authLogger = logger.withContext({
      feature: 'auth',
      component: 'login_screen',
    });

    authLogger.info('auth.login.succeeded', {
      provider: 'google',
      durationMs: 450,
    });

    const entries = memoryTransport.getEntries();
    const [entry] = entries;

    assert.ok(entry);
    assert.deepEqual(entry.fields, {
      feature: 'auth',
      component: 'login_screen',
      provider: 'google',
      durationMs: 450,
    });
  });

  it('does not add child context to the parent logger', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    const authLogger = logger.withContext({
      feature: 'auth',
    });

    authLogger.info('auth.login.started');
    logger.info('app_started');

    const entries = memoryTransport.getEntries();
    const [authEntry, appEntry] = entries;

    assert.ok(authEntry);
    assert.ok(appEntry);

    assert.deepEqual(authEntry.fields, {
      feature: 'auth',
    });

    assert.deepEqual(appEntry.fields, {});
  });

  it('allows event fields to override inherited context', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    const requestLogger = logger.withContext({
      feature: 'network',
      attempt: 1,
    });

    requestLogger.warn('network.request.retrying', {
      attempt: 2,
    });

    const [entry] = memoryTransport.getEntries();

    assert.ok(entry);
    assert.deepEqual(entry.fields, {
      feature: 'network',
      attempt: 2,
    });
  });

  it('normalizes Error objects before delivery', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    const rootCause = new TypeError('Network unavailable');

    const error = new Error('Login failed', {
      cause: rootCause,
    });

    logger.error('auth.login.failed', {
      error,
    });

    const [entry] = memoryTransport.getEntries();

    assert.ok(entry);

    const normalizedError = entry.fields['error'];

    assert.ok(
      typeof normalizedError === 'object' &&
        normalizedError !== null &&
        !Array.isArray(normalizedError),
    );

    const errorFields = normalizedError as Record<string, unknown>;

    assert.equal(errorFields['name'], 'Error');
    assert.equal(errorFields['message'], 'Login failed');
    assert.equal(typeof errorFields['stack'], 'string');

    const normalizedCause = errorFields['cause'];

    assert.ok(
      typeof normalizedCause === 'object' &&
        normalizedCause !== null &&
        !Array.isArray(normalizedCause),
    );

    const causeFields = normalizedCause as Record<string, unknown>;

    assert.equal(causeFields['name'], 'TypeError');
    assert.equal(causeFields['message'], 'Network unavailable');
    assert.equal(typeof causeFields['stack'], 'string');

    assert.doesNotThrow(() => {
      JSON.stringify(entry);
    });
  });

  it('handles a circular error cause safely', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    const error = new Error('Circular failure');

    (
      error as Error & {
        cause?: unknown;
      }
    ).cause = error;

    assert.doesNotThrow(() => {
      logger.error('operation.failed', {
        error,
      });
    });

    const [entry] = memoryTransport.getEntries();

    assert.ok(entry);

    const normalizedError = entry.fields['error'];

    assert.ok(
      typeof normalizedError === 'object' &&
        normalizedError !== null &&
        !Array.isArray(normalizedError),
    );

    const errorFields = normalizedError as Record<string, unknown>;

    assert.equal(errorFields['cause'], '[Circular]');
  });

  it('converts JSON-unsafe values into safe values', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    function submitLogin(): void {}

    logger.info('normalization.example', {
      bigInteger: 9_007_199_254_740_993n,
      notANumber: Number.NaN,
      positiveInfinity: Number.POSITIVE_INFINITY,
      negativeInfinity: Number.NEGATIVE_INFINITY,
      missing: undefined,
      callback: submitLogin,
      symbol: Symbol('example'),
      occurredAt: new Date(FIXED_TIMESTAMP),
      pattern: /login/i,
      tags: new Set(['auth', 'mobile']),
      metadata: new Map([['status', 'ready']]),
      circular,
    });

    const [entry] = memoryTransport.getEntries();

    assert.ok(entry);

    assert.equal(entry.fields['bigInteger'], '9007199254740993n');

    assert.equal(entry.fields['notANumber'], '[NaN]');

    assert.equal(entry.fields['positiveInfinity'], '[Infinity]');

    assert.equal(entry.fields['negativeInfinity'], '[-Infinity]');

    assert.equal(entry.fields['missing'], '[Undefined]');

    assert.equal(entry.fields['callback'], '[Function: submitLogin]');

    assert.equal(entry.fields['symbol'], 'Symbol(example)');

    assert.equal(entry.fields['occurredAt'], FIXED_TIMESTAMP);

    assert.equal(entry.fields['pattern'], '/login/i');

    assert.deepEqual(entry.fields['tags'], ['auth', 'mobile']);

    assert.deepEqual(entry.fields['metadata'], [
      {
        key: 'status',
        value: 'ready',
      },
    ]);

    assert.deepEqual(entry.fields['circular'], {
      self: '[Circular]',
    });

    assert.doesNotThrow(() => {
      JSON.stringify(entry);
    });
  });

  it('contains a property getter that throws', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    const fields: Record<string, unknown> = {
      safe: 'retained',
    };

    Object.defineProperty(fields, 'dangerous', {
      enumerable: true,
      get() {
        throw new Error('Getter failed');
      },
    });

    assert.doesNotThrow(() => {
      logger.info('normalization.getter_example', fields);
    });

    const [entry] = memoryTransport.getEntries();

    assert.ok(entry);

    assert.deepEqual(entry.fields, {
      safe: 'retained',
      dangerous: '[Unreadable property]',
    });
  });

  it('limits large strings and deeply nested values', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    let nestedValue: Record<string, unknown> = {
      result: 'bottom',
    };

    for (let depth = 0; depth < 10; depth += 1) {
      nestedValue = {
        child: nestedValue,
      };
    }

    logger.info('normalization.limits', {
      largeText: 'x'.repeat(10_001),
      nestedValue,
    });

    const [entry] = memoryTransport.getEntries();

    assert.ok(entry);

    const largeText = entry.fields['largeText'];

    assert.ok(typeof largeText === 'string');

    assert.equal(largeText.endsWith('…[1 characters omitted]'), true);

    assert.equal(JSON.stringify(entry).includes('[Maximum depth 8 reached]'), true);
  });

  it('redacts sensitive fields before transport delivery', () => {
    const memoryTransport = new MemoryTransport();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    logger.info('security.redaction.example', {
      username: 'krishan',
      password: 'my-real-password',
      nested: {
        accessToken: 'secret-access-token',
        theme: 'dark',
      },
      requests: [
        {
          headers: {
            Authorization: 'Bearer secret-token',
          },
          status: 200,
        },
      ],
    });

    const [entry] = memoryTransport.getEntries();

    assert.ok(entry);

    assert.deepEqual(entry.fields, {
      username: 'krishan',
      password: '[Redacted]',
      nested: {
        accessToken: '[Redacted]',
        theme: 'dark',
      },
      requests: [
        {
          headers: {
            Authorization: '[Redacted]',
          },
          status: 200,
        },
      ],
    });
  });

  it('redacts email identifiers from ordinary log entries', () => {
    const memoryTransport = new MemoryTransport();
    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    logger.info('normalization.example', {
      email: 'alice@example.com',
      emailId: 'alice@example.com',
    });

    const [entry] = memoryTransport.getEntries();
    assert.ok(entry);
    assert.deepEqual(entry.fields, {
      email: '[Redacted]',
      emailId: '[Redacted]',
    });
  });

  it('includes authenticated email only in the serialized remote record', () => {
    const memoryTransport = new MemoryTransport();
    const contextStore = new InMemoryLogContextStore();
    contextStore.set({ email: ' alice@example.com ' });

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
      contextStore,
      includeEmailInRemoteRecords: true,
    });

    logger.info('auth.login.started');

    const [entry] = memoryTransport.getEntries();
    assert.ok(entry);
    assert.equal(entry.fields['email'], '[Redacted]');
    assert.equal(JSON.stringify(entry).includes('alice@example.com'), false);
    assert.equal(toRemoteLogRecord(entry)['email'], 'alice@example.com');
  });

  it('redacts bearer and query credentials embedded in strings', () => {
    const memoryTransport = new MemoryTransport();
    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });

    logger.error('security.redaction.example', {
      error: new Error(
        'request failed Authorization: Bearer secret-token at https://example.test?access_token=secret-query',
      ),
      redirect: 'https://example.test?token=secret-token&ok=1',
    });

    const [entry] = memoryTransport.getEntries();
    assert.ok(entry);
    assert.deepEqual(entry.fields['redirect'], 'https://example.test?token=[Redacted]&ok=1');

    const error = entry.fields['error'];
    assert.ok(error && typeof error === 'object' && !Array.isArray(error));
    assert.equal(
      (error as Record<string, unknown>)['message'],
      'request failed Authorization: Bearer [Redacted] at https://example.test?access_token=[Redacted]',
    );
  });

  it('snapshots dynamic context at emit time', () => {
    const memoryTransport = new MemoryTransport();
    const contextStore = new InMemoryLogContextStore();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
      context: {
        serviceName: 'xynespaces-native',
      },
      contextStore,
    });

    logger.info('app_started');

    contextStore.set({
      userId: 'user-1',
      email: 'alice@example.com',
    });

    logger.info('auth.login.started');

    const [anonymousEntry, identifiedEntry] = memoryTransport.getEntries();

    assert.ok(anonymousEntry);
    assert.ok(identifiedEntry);

    assert.deepEqual(anonymousEntry.fields, {
      serviceName: 'xynespaces-native',
    });

    assert.deepEqual(identifiedEntry.fields, {
      serviceName: 'xynespaces-native',
      userId: 'user-1',
      email: '[Redacted]',
    });
  });

  it('shares the context store with contextual child loggers', () => {
    const memoryTransport = new MemoryTransport();
    const contextStore = new InMemoryLogContextStore();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
      contextStore,
    });

    const authLogger = logger.withContext({
      feature: 'auth',
    });

    contextStore.set({
      userId: 'user-1',
    });

    authLogger.info('auth.login.started');

    const [entry] = memoryTransport.getEntries();

    assert.ok(entry);
    assert.deepEqual(entry.fields, {
      feature: 'auth',
      userId: 'user-1',
    });
  });

  it('does not change an already emitted entry when identity later changes', () => {
    const memoryTransport = new MemoryTransport();
    const contextStore = new InMemoryLogContextStore();

    const logger = new Logger<TestLogEventMap>({
      clock: fixedClock,
      minimumLevel: 'debug',
      transports: [memoryTransport],
      contextStore,
    });

    contextStore.set({
      userId: 'user-1',
      email: 'alice@example.com',
    });

    logger.info('app_started');

    contextStore.unset(['userId', 'email']);

    const [entry] = memoryTransport.getEntries();

    assert.ok(entry);
    assert.deepEqual(entry.fields, {
      userId: 'user-1',
      email: '[Redacted]',
    });
  });
});
