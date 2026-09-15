import { createHmac, timingSafeEqual } from 'crypto';

const GRANT_VERSION = 1 as const;
const GRANT_TTL_MS = 30 * 60_000;

export interface SdlcInteractiveGrantClaims {
  version: typeof GRANT_VERSION;
  agentSlug: 'sdlc-agent';
  workspaceId: string;
  repoId: string;
  actorUserId: string;
  conversationId: string;
  issuedAt: string;
  expiresAt: string;
}

function requireSecret(secret: string): string {
  if (!secret.trim()) throw new Error('SDLC interactive grant secret is unavailable');
  return secret;
}

function signature(secret: string, payload: string): Buffer {
  return createHmac('sha256', requireSecret(secret)).update(payload).digest();
}

export function issueSdlcInteractiveGrant(
  input: Omit<SdlcInteractiveGrantClaims, 'version' | 'issuedAt' | 'expiresAt'>,
  secret: string,
  now = new Date(),
): string {
  const claims: SdlcInteractiveGrantClaims = {
    version: GRANT_VERSION,
    ...input,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + GRANT_TTL_MS).toISOString(),
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${payload}.${signature(secret, payload).toString('base64url')}`;
}

export function verifySdlcInteractiveGrant(
  token: string,
  secret: string,
  now = new Date(),
): SdlcInteractiveGrantClaims {
  const [payload, encodedSignature, extra] = token.split('.');
  if (!payload || !encodedSignature || extra) throw new Error('Invalid SDLC interactive grant');
  const actual = Buffer.from(encodedSignature, 'base64url');
  const expected = signature(secret, payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Invalid SDLC interactive grant');
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid SDLC interactive grant');
  }
  const value = claims as Partial<SdlcInteractiveGrantClaims>;
  if (
    value.version !== GRANT_VERSION ||
    value.agentSlug !== 'sdlc-agent' ||
    !value.workspaceId ||
    !value.repoId ||
    !value.actorUserId ||
    !value.conversationId ||
    !value.issuedAt ||
    !value.expiresAt ||
    !Number.isFinite(Date.parse(value.issuedAt)) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) <= now.getTime()
  ) {
    throw new Error('Invalid or expired SDLC interactive grant');
  }
  return value as SdlcInteractiveGrantClaims;
}
