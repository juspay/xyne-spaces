const mockConfig = { allowedEmailDomains: [] as string[] };
jest.mock('@/config/env', () => ({ config: mockConfig }));

import {
  EMAIL_DOMAIN_NOT_ALLOWED_ERROR,
  EMAIL_NOT_VERIFIED_ERROR,
  getProviderLoginDenial,
  isEmailDomainAllowed,
  isMicrosoftEmailVerified,
} from '../emailDomainPolicy';

describe('emailDomainPolicy', () => {
  describe('with no allowlist', () => {
    beforeEach(() => {
      mockConfig.allowedEmailDomains = [];
    });

    it('allows every email', () => {
      expect(isEmailDomainAllowed('someone@gmail.com')).toBe(true);
      expect(isEmailDomainAllowed(null)).toBe(true);
    });

    it('does not start requiring a verified email', () => {
      expect(getProviderLoginDenial('someone@gmail.com', false)).toBeNull();
    });
  });

  describe('with an allowlist', () => {
    beforeEach(() => {
      mockConfig.allowedEmailDomains = ['xyz.com', 'abc.com'];
    });

    it.each(['a@xyz.com', 'a@abc.com', 'A@XYZ.COM', ' a@xyz.com '])('allows %s', email => {
      expect(isEmailDomainAllowed(email)).toBe(true);
    });

    it.each([
      'a@gmail.com',
      'a@evilxyz.com',
      'a@xyz.com.evil.com',
      'a@team.xyz.com',
      'a@xyz.com@evil.com',
      'xyz.com',
      'a@',
      '',
      null,
      undefined,
    ])('rejects %s', email => {
      expect(isEmailDomainAllowed(email)).toBe(false);
    });

    it('allows a verified provider login from an allowed domain', () => {
      expect(getProviderLoginDenial('a@xyz.com', true)).toBeNull();
    });

    it('rejects an allowed domain the provider has not verified', () => {
      expect(getProviderLoginDenial('a@xyz.com', false)?.error).toBe(EMAIL_NOT_VERIFIED_ERROR);
    });

    it('rejects a verified login from another domain', () => {
      expect(getProviderLoginDenial('a@gmail.com', true)?.error).toBe(
        EMAIL_DOMAIN_NOT_ALLOWED_ERROR,
      );
    });
  });

  describe('isMicrosoftEmailVerified', () => {
    it.each([true, 1, '1', 'true'])('treats %p as verified', claim => {
      expect(isMicrosoftEmailVerified(claim)).toBe(true);
    });

    it.each([false, 0, '0', 'false', undefined, null, ''])('treats %p as unverified', claim => {
      expect(isMicrosoftEmailVerified(claim)).toBe(false);
    });
  });
});
