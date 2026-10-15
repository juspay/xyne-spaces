import { decodeBase64Utf8 } from '@/src/utils/base64Utf8';

export interface AuthJwtClaims {
  sub?: string;
  email?: string;
  workspaceId?: string;
  memberId?: string;
  exp?: number;
}

/**
 * Reads JWT claims without verifying the signature — the server is the only
 * authority on validity; we only need `exp`/`workspaceId` to decide when to
 * refresh. Kept free of native imports so it is usable from plain Node tests.
 */
export function decodeAuthJwtClaims(token: string): AuthJwtClaims | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const normalized = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(decodeBase64Utf8(padded)) as AuthJwtClaims;
  } catch {
    return null;
  }
}

export function isTokenExpiringSoon(token: string, minValiditySeconds: number = 300): boolean {
  const exp = decodeAuthJwtClaims(token)?.exp;
  if (!exp) {
    return true;
  }

  return exp * 1000 - Date.now() <= minValiditySeconds * 1000;
}
