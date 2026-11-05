import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEncryptionErrorReporter } from '../callEncryptionErrors';

const cryptorError = (reason: number, message = 'e2ee error'): Error =>
  Object.assign(new Error(message), { reason });

describe('createEncryptionErrorReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const log = vi.fn<(fields: Record<string, unknown>) => void>();
    const notify = vi.fn<(kind: string) => void>();
    const reporter = createEncryptionErrorReporter({ log, notify, now: () => Date.now() });
    return { log, notify, reporter };
  };

  it('stays quiet when missing-key errors stop within the grace period, but logs them', () => {
    const { log, notify, reporter } = setup();
    reporter.report(cryptorError(1), 'phone');
    vi.advanceTimersByTime(300);
    reporter.report(cryptorError(1), 'phone');
    vi.advanceTimersByTime(3000);

    expect(notify).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'encryption_missing_key_resolved', durationMs: 300 }),
    );
  });

  it('notifies when missing-key errors are still arriving after the grace period', () => {
    const { log, notify, reporter } = setup();
    reporter.report(cryptorError(1), 'phone');
    for (let t = 0; t < 3000; t += 500) {
      vi.advanceTimersByTime(500);
      reporter.report(cryptorError(1), 'phone');
    }
    vi.advanceTimersByTime(1);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('missing_key');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'encryption_missing_key_persisted' }),
    );
  });

  it('notifies immediately for a wrong key, with no grace period', () => {
    const { notify, reporter } = setup();
    reporter.report(cryptorError(0, 'invalid key'), 'phone');
    expect(notify).toHaveBeenCalledWith('decrypt_failure');
  });

  it('notifies immediately for internal and untyped errors', () => {
    const a = setup();
    a.reporter.report(cryptorError(2), 'phone');
    expect(a.notify).toHaveBeenCalledWith('decrypt_failure');

    const b = setup();
    b.reporter.report(new Error('worker crashed'));
    expect(b.notify).toHaveBeenCalledWith('decrypt_failure');
  });

  it('logs every error and notifies at most once per call', () => {
    const { log, notify, reporter } = setup();
    reporter.report(cryptorError(0), 'a');
    reporter.report(cryptorError(0), 'b');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.filter(([f]) => f.eventName === 'encryption_error')).toHaveLength(2);
  });

  it('tracks participants separately and dispose cancels pending checks', () => {
    const { log, notify, reporter } = setup();
    reporter.report(cryptorError(1), 'a');
    reporter.report(cryptorError(1), 'b');
    reporter.dispose();
    vi.advanceTimersByTime(10000);
    expect(notify).not.toHaveBeenCalled();
    const names = log.mock.calls.map(([fields]) => String(fields.eventName));
    expect(names.filter(name => name.startsWith('encryption_missing_key'))).toEqual([]);
  });
});
