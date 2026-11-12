import { generateKeyPairSync, randomUUID, sign } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const pem = (k: { export: (o: object) => string | Buffer }, type: string) => k.export({ type, format: 'pem' }).toString();
const spaces = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const claw = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const runtime = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const mockConfig = {
  xyneClaw: {
    delegationPrivateKey: pem(spaces.privateKey, 'pkcs8'),
    delegationKeyId: 'spaces-1',
    servicePublicKeys: JSON.stringify({ 'claw-1': pem(claw.publicKey, 'spki') }),
    runtimePublicKeys: JSON.stringify({ 'runtime-1': pem(runtime.publicKey, 'spki') }),
  },
};
jest.mock('@/config/env', () => ({ config: mockConfig }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const seen = new Set<string>();
jest.mock('@/services/redisService', () => ({
  redisService: { set: jest.fn(async (k: string) => (seen.has(k) ? false : (seen.add(k), true))) },
}));

import { authenticateService, serviceAuthHeaders } from './serviceAuth';
import { verifyEs256, spacesPublicKey } from './jwt';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function assertion(key: typeof claw.privateKey, kid: string, claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'ES256', typ: 'xyne-service+jwt', kid })}.${b64({ iss: 'xyne-claw-auth', aud: 'xyne-spaces', iat: now, exp: now + 60, jti: randomUUID(), htm: 'POST', htu: '/api/claw-agents/service/token', ...claims })}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
async function call(gate: ReturnType<typeof authenticateService>, token: string) {
  const req = { headers: { 'x-service-assertion': token }, method: 'POST', originalUrl: '/api/claw-agents/service/token' } as unknown as Request;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  const next = jest.fn() as unknown as NextFunction;
  await gate(req, res, next);
  return { req, res: res as unknown as { status: jest.Mock }, next: next as unknown as jest.Mock };
}

describe('authenticateService', () => {
  it('accepts claw-auth and the runtime, each only with its own key', async () => {
    const gate = authenticateService('xyne-claw-auth', 'xyne-claw');
    expect((await call(gate, assertion(claw.privateKey, 'claw-1'))).next).toHaveBeenCalled();
    const r = await call(gate, assertion(runtime.privateKey, 'runtime-1', { iss: 'xyne-claw' }));
    expect(r.next).toHaveBeenCalled();
    expect(r.req.clawService?.iss).toBe('xyne-claw');
    // runtime key claiming to be claw-auth, and claw-auth's key claiming to be the runtime
    expect((await call(gate, assertion(runtime.privateKey, 'claw-1'))).res.status).toHaveBeenCalledWith(401);
    expect((await call(gate, assertion(claw.privateKey, 'runtime-1', { iss: 'xyne-claw' }))).res.status).toHaveBeenCalledWith(401);
  });

  it('refuses callers the route does not list, and replays', async () => {
    expect((await call(authenticateService('xyne-claw-auth'), assertion(runtime.privateKey, 'runtime-1', { iss: 'xyne-claw' }))).res.status).toHaveBeenCalledWith(401);
    const t = assertion(claw.privateKey, 'claw-1');
    expect((await call(authenticateService('xyne-claw-auth'), t)).next).toHaveBeenCalled();
    expect((await call(authenticateService('xyne-claw-auth'), t)).res.status).toHaveBeenCalledWith(401);
  });

  it("Spaces signs its outbound calls with its own key, bound to the path", () => {
    const h = serviceAuthHeaders('xyne-claw-auth', 'post', 'http://claw-auth:3003/claw/api/v1/internal/agents/check?x=1');
    const v = verifyEs256(h['x-service-assertion'], spacesPublicKey, { issuer: 'xyne-spaces', audience: 'xyne-claw-auth', typ: 'xyne-service+jwt', maxLifetimeSeconds: 120 });
    expect(typeof v).not.toBe('string');
    if (typeof v !== 'string') expect(v.payload).toMatchObject({ htm: 'POST', htu: '/claw/api/v1/internal/agents/check' });
  });
});
