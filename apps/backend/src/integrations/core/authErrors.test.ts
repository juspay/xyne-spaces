import { isPermanentAuthError } from './authErrors';

describe('isPermanentAuthError', () => {
  it('matches the standard OAuth2 permanent error codes', () => {
    expect(isPermanentAuthError('invalid_grant')).toBe(true);
    expect(isPermanentAuthError('unauthorized_client')).toBe(true);
    expect(isPermanentAuthError('invalid_token')).toBe(true);
    expect(isPermanentAuthError('invalid_client')).toBe(true);
  });

  it('matches the google-auth-library "no refresh token" failure that used to slip through', () => {
    // This is the exact message that dominated the Aug-2026 desk mail incident
    // and was NOT caught by the old narrow regex.
    expect(
      isPermanentAuthError(
        'Failed to setup Gmail watch: No access, refresh token, API key or refresh handler callback is set.',
      ),
    ).toBe(true);
    expect(isPermanentAuthError('refresh handler callback is not set')).toBe(true);
  });

  it('matches Google\'s explicit revoke/expiry message', () => {
    expect(
      isPermanentAuthError('Token has been expired or revoked.'),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isPermanentAuthError('INVALID_GRANT')).toBe(true);
    expect(isPermanentAuthError('No Access, Refresh Token missing')).toBe(true);
  });

  it('accepts Error objects and stringifiable values', () => {
    expect(isPermanentAuthError(new Error('invalid_grant'))).toBe(true);
    expect(isPermanentAuthError({ toString: () => 'invalid_token' })).toBe(true);
  });

  it('does NOT flag transient / unrelated failures', () => {
    expect(isPermanentAuthError('ETIMEDOUT')).toBe(false);
    expect(isPermanentAuthError('rateLimitExceeded')).toBe(false);
    expect(isPermanentAuthError('Internal error, please retry')).toBe(false);
    expect(isPermanentAuthError('')).toBe(false);
    expect(isPermanentAuthError(null)).toBe(false);
    expect(isPermanentAuthError(undefined)).toBe(false);
  });
});
