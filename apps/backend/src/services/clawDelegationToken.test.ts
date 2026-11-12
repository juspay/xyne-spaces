import { generateKeyPairSync, verify, type KeyObject } from 'crypto';

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const mockConfig = { xyneClaw: { delegationPrivateKey: privatePem, delegationKeyId: 'spaces-test' } };
jest.mock('@/config/env', () => ({ config: mockConfig }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { clawDelegationHeaders, mintClawDelegationToken, CLAW_DELEGATION_HEADER } from './clawDelegationToken';

/** The checks claw-auth makes (lib/spaces-delegation.ts), done with node:crypto. */
function verifyLikeClawAuth(token: string, publicKey: KeyObject) {
  const [h, p, sig] = token.split('.');
  const header = JSON.parse(Buffer.from(h!, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
  const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url'));
  return { ok, header, payload };
}

describe('clawDelegationToken', () => {
  beforeEach(() => {
    mockConfig.xyneClaw.delegationPrivateKey = privatePem;
  });

  it('mints an ES256 token with the claims claw-auth requires', () => {
    const token = mintClawDelegationToken({ spacesUserId: 'user-1', workspaceId: 'ws-1', purpose: 'test' })!;
    const { ok, header, payload } = verifyLikeClawAuth(token, keys.publicKey);
    expect(ok).toBe(true);
    expect(header).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'spaces-test' });
    expect(payload).toMatchObject({ iss: 'xyne-spaces', aud: 'xyne-claw-auth', sub: 'user-1', ws: 'ws-1', prp: 'test' });
    expect(typeof payload.jti).toBe('string');
    expect(payload.exp - payload.iat).toBe(300);
  });

  it('does not verify against a different public key', () => {
    const token = mintClawDelegationToken({ spacesUserId: 'user-1' })!;
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    expect(verifyLikeClawAuth(token, other.publicKey).ok).toBe(false);
  });

  it('returns no header when no key is configured, so callers fall back to the legacy contract', () => {
    mockConfig.xyneClaw.delegationPrivateKey = '';
    expect(mintClawDelegationToken({ spacesUserId: 'user-1' })).toBeUndefined();
    expect(clawDelegationHeaders('user-1')).toEqual({});
  });

  it('refuses a non P-256 key', () => {
    mockConfig.xyneClaw.delegationPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(mintClawDelegationToken({ spacesUserId: 'user-1' })).toBeUndefined();
  });

  it('returns no header for an empty user, and uses the header name claw-auth reads', () => {
    expect(clawDelegationHeaders('')).toEqual({});
    expect(clawDelegationHeaders(undefined)).toEqual({});
    expect(Object.keys(clawDelegationHeaders('user-1'))).toEqual([CLAW_DELEGATION_HEADER]);
    expect(CLAW_DELEGATION_HEADER).toBe('x-spaces-delegation');
  });
});
