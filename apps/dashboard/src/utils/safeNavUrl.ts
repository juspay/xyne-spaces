import { TRUSTED_ORIGINS } from '@xyne/shared';

/**
 * A server-supplied URL that is safe to navigate to: http(s) only, same-origin URLs become
 * paths, trusted origins pass through, and anything else (javascript:, data:, foreign
 * hosts, unparseable) becomes `fallback`.
 */
export const toSafeAppUrl = (raw: string | undefined | null, fallback: string): string => {
  if (!raw) return fallback;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
    if (url.origin === window.location.origin) return `${url.pathname}${url.search}${url.hash}`;
    return TRUSTED_ORIGINS.includes(url.origin) ? url.href : fallback;
  } catch {
    return fallback;
  }
};
