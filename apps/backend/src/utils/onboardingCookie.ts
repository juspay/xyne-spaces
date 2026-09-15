import type { CookieOptions, Response } from 'express';

type OnboardingCookieOptions = Pick<CookieOptions, 'secure' | 'sameSite'> & {
  maxAge?: number;
};

export const ONBOARDING_COOKIE_NAME = 'is_new_user';
export const DEFAULT_ONBOARDING_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function setOnboardingCookie(
  res: Response,
  isNewUser: boolean,
  options: OnboardingCookieOptions,
): void {
  if (!isNewUser) {
    res.clearCookie(ONBOARDING_COOKIE_NAME, { path: '/' });
    return;
  }

  res.cookie(ONBOARDING_COOKIE_NAME, 'true', {
    httpOnly: false,
    secure: options.secure,
    sameSite: options.sameSite,
    path: '/',
    maxAge: options.maxAge ?? DEFAULT_ONBOARDING_COOKIE_MAX_AGE_MS,
  });
}
