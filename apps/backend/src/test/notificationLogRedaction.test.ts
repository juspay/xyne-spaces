import { redactMetadata } from '@/notification-service/logging/redactMetadata';

describe('redactMetadata (SDLCT-0002)', () => {
  it('returns undefined for non-object input', () => {
    expect(redactMetadata(undefined)).toBeUndefined();
    expect(redactMetadata(null)).toBeUndefined();
    expect(redactMetadata('a string')).toBeUndefined();
    expect(redactMetadata(42)).toBeUndefined();
  });

  it('keeps only allowlisted scalar diagnostic keys', () => {
    const out = redactMetadata({
      notificationType: 'MENTION',
      platform: 'ios',
      appVersion: '1.2.3',
      attempt: 2,
      silent: false,
    });
    expect(out).toEqual({
      notificationType: 'MENTION',
      platform: 'ios',
      appVersion: '1.2.3',
      attempt: 2,
      silent: false,
    });
  });

  it('drops keys that are not on the allowlist', () => {
    const out = redactMetadata({
      notificationType: 'MENTION',
      randomField: 'nope',
      userId: 'user_123',
    });
    expect(out).toEqual({ notificationType: 'MENTION' });
  });

  it('drops sensitive content even if the key would otherwise pass fragment check', () => {
    // 'message'/'title'/'token'/'email' fragments force a drop.
    const out = redactMetadata({
      message: 'secret body text',
      title: 'Private subject',
      fcmToken: 'abc',
      email: 'a@b.com',
      platform: 'android',
    });
    expect(out).toEqual({ platform: 'android' });
  });

  it('drops non-scalar values', () => {
    const out = redactMetadata({
      platform: 'ios',
      relatedEntityId: { nested: true } as unknown as string,
      attempt: [1, 2, 3] as unknown as number,
    });
    expect(out).toEqual({ platform: 'ios' });
  });

  it('truncates long strings to the max length with an ellipsis', () => {
    const long = 'x'.repeat(500);
    const out = redactMetadata({ relatedEntityId: long });
    expect(out).toBeDefined();
    const value = out!.relatedEntityId as string;
    expect(value.length).toBe(257); // 256 chars + ellipsis
    expect(value.endsWith('…')).toBe(true);
  });

  it('returns undefined when nothing survives', () => {
    expect(redactMetadata({ message: 'hi', token: 'x', foo: 'bar' })).toBeUndefined();
  });
});
