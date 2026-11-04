import { config } from '@/config/env';

export const EMAIL_DOMAIN_NOT_ALLOWED_ERROR = 'email_domain_not_allowed';
export const EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE = 'Your email domain is not allowed to sign in.';
export const EMAIL_NOT_VERIFIED_ERROR = 'email_not_verified';
export const EMAIL_NOT_VERIFIED_MESSAGE =
  'Your sign-in provider has not verified this email address.';

export interface LoginDenial {
  error: string;
  message: string;
}

export function extractEmailDomain(email: string): string | null {
  const normalizedEmail = email.trim().toLowerCase();
  const atIndex = normalizedEmail.lastIndexOf('@');
  if (atIndex < 0 || atIndex === normalizedEmail.length - 1) {
    return null;
  }
  return normalizedEmail.slice(atIndex + 1);
}

/** With ALLOWED_EMAIL_DOMAINS unset every email is allowed. Subdomains must be listed explicitly. */
export function isEmailDomainAllowed(email: string | null | undefined): boolean {
  const allowedDomains = config.allowedEmailDomains;
  if (allowedDomains.length === 0) {
    return true;
  }
  const domain = email ? extractEmailDomain(email) : null;
  return !!domain && allowedDomains.includes(domain);
}

/**
 * Whether a domain is explicitly on the allowlist. Unlike isEmailDomainAllowed an empty list
 * matches nothing, so a domain is only ever tied to an organization when it is listed.
 */
export function isDomainAllowlisted(domain: string | null | undefined): boolean {
  return !!domain && config.allowedEmailDomains.includes(domain);
}

/**
 * Decides a Google/Microsoft sign-in. The domain is only proof of identity if the provider
 * verified the address, so an unverified email is refused — but only when the allowlist is on,
 * leaving deployments without one unchanged.
 */
export function getProviderLoginDenial(
  email: string | null | undefined,
  emailVerified: boolean,
): LoginDenial | null {
  if (config.allowedEmailDomains.length === 0) {
    return null;
  }
  if (!isEmailDomainAllowed(email)) {
    return { error: EMAIL_DOMAIN_NOT_ALLOWED_ERROR, message: EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE };
  }
  if (!emailVerified) {
    return { error: EMAIL_NOT_VERIFIED_ERROR, message: EMAIL_NOT_VERIFIED_MESSAGE };
  }
  return null;
}

/**
 * Microsoft's `email` claim can be set by any tenant admin, so it only proves the domain when
 * `xms_edov` says the domain owner is verified. Entra can emit this claim as a boolean or as
 * "1"/"true", and only includes it if it is configured as an optional claim on the app.
 */
export function isMicrosoftEmailVerified(claim: unknown): boolean {
  return claim === true || claim === 1 || claim === '1' || claim === 'true';
}
