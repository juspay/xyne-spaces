import { generateKeyPairSync, randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const spaces = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const clawAuth = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const stranger = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = (k: { export: (o: object) => string | Buffer }, type: string) => k.export({ type, format: 'pem' }).toString();

const mockConfig = {
  xyneClaw: {
    delegationPrivateKey: pem(spaces.privateKey, 'pkcs8'),
    delegationKeyId: 'spaces-1',
    servicePublicKeys: JSON.stringify({ 'claw-1': pem(clawAuth.publicKey, 'spki') }),
  },
};
jest.mock('@/config/env', () => ({ config: mockConfig }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const mockRedis = { set: jest.fn() };
jest.mock('@/services/redisService', () => ({ redisService: mockRedis }));

const mockUsers: Record<string, { id: string; workspaceId: string; status: string; orgMemberId: string; providerUserId: string; email: string; name: string; role: string }> = {};
jest.mock('@/database/repositories', () => ({
  repositories: {
    users: { findById: jest.fn(async (id: string) => mockUsers[id] ?? null) },
    orgMembers: { findById: jest.fn(async () => ({ role: 'MEMBER' })) },
  },
}));
jest.mock('@/database/tenant/context', () => ({ runAsSystem: (fn: () => unknown) => fn() }));

const mockPrincipals: Record<string, { id: string; workspaceId: string; orgId: string; clawAgentId: string; name: string; botUserId: string; status: string }> = {};
const mockAgentScopes: Record<string, string[]> = {};
const mockDelegations: Record<string, string[]> = {};
jest.mock('./principals', () => {
  class ClawAgentError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
  return {
    ClawAgentError,
    findPrincipal: jest.fn(async (id: string) => mockPrincipals[id] ?? null),
    isActive: (p: { status: string } | null) => !!p && p.status === 'ACTIVE',
    agentScopes: jest.fn(async (p: { id: string }) => mockAgentScopes[p.id] ?? []),
    onBehalfOfScopes: jest.fn(async (p: { id: string }, userId: string, requireDelegation: boolean) => {
      const agent = mockAgentScopes[p.id] ?? [];
      if (!requireDelegation) return agent;
      return (mockDelegations[`${p.id}|${userId}`] ?? []).filter((s) => agent.includes(s));
    }),
  };
});

import { signEs256, verifyEs256, spacesPublicKey } from './jwt';
import { authenticateClawService } from './serviceAuth';
import { authenticateClawAgent, issueAgentToken, looksLikeAgentToken } from './tokens';
import { mintClawDelegationToken } from '@/services/clawDelegationToken';

const now = () => Math.floor(Date.now() / 1000);

function call(headers: Record<string, string>, method = 'POST', url = '/api/claw-agents/service/token') {
  const req = { headers, method, originalUrl: url, url, path: url } as unknown as Request;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  const next = jest.fn() as unknown as NextFunction;
  return { req, res, next };
}

function assertion(overrides: Record<string, unknown> = {}, key = clawAuth.privateKey, kid = 'claw-1') {
  const t = now();
  return signEs256(
    { iss: 'xyne-claw-auth', aud: 'xyne-spaces', iat: t, exp: t + 60, jti: randomUUID(), htm: 'POST', htu: '/api/claw-agents/service/token', ...overrides },
    key,
    kid,
    'xyne-service+jwt'
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.set.mockResolvedValue(true);
  for (const k of Object.keys(mockPrincipals)) delete mockPrincipals[k];
  for (const k of Object.keys(mockUsers)) delete mockUsers[k];
  for (const k of Object.keys(mockAgentScopes)) delete mockAgentScopes[k];
  for (const k of Object.keys(mockDelegations)) delete mockDelegations[k];
  mockPrincipals['p1'] = { id: 'p1', workspaceId: 'ws1', orgId: 'o1', clawAgentId: 'agent-a', name: 'A', botUserId: 'bot1', status: 'ACTIVE' };
  const base = { status: 'ACTIVE', orgMemberId: 'm', providerUserId: 'x', email: 'e', name: 'n', role: 'MEMBER' };
  mockUsers['bot1'] = { id: 'bot1', workspaceId: 'ws1', ...base };
  mockUsers['alice'] = { id: 'alice', workspaceId: 'ws1', ...base };
  mockUsers['mallory'] = { id: 'mallory', workspaceId: 'ws2', ...base };
  mockAgentScopes['p1'] = ['chat:write', 'channels:read'];
});

describe('verifyEs256', () => {
  const opts = { issuer: 'xyne-claw-auth', audience: 'xyne-spaces', maxLifetimeSeconds: 120 };
  const resolve = (kid: string) => (kid === 'claw-1' ? clawAuth.publicKey : undefined);
  it('accepts a valid token', () => {
    expect(typeof verifyEs256(assertion(), resolve, opts)).toBe('object');
  });
  it.each([
    ['signed by another key', () => assertion({}, stranger.privateKey), 'bad-signature'],
    ['unknown kid', () => assertion({}, clawAuth.privateKey, 'nope'), 'unknown-key'],
    ['wrong audience', () => assertion({ aud: 'other' }), 'bad-claims'],
    ['expired', () => assertion({ iat: now() - 600, exp: now() - 500 }), 'expired'],
    ['lifetime too long', () => assertion({ exp: now() + 3600 }), 'lifetime-too-long'],
  ])('rejects a token %s', (_n, make, reason) => {
    expect(verifyEs256(make(), resolve, opts)).toBe(reason);
  });
});

describe('authenticateClawService', () => {
  it('accepts a fresh assertion bound to this request', async () => {
    const { req, res, next } = call({ 'x-service-assertion': assertion() });
    await authenticateClawService(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.clawService?.kid).toBe('claw-1');
  });
  it.each([
    ['for another path', { htu: '/api/claw-agents/service/principals' }],
    ['for another method', { htm: 'GET' }],
    ['without jti', { jti: '' }],
  ])('rejects an assertion %s', async (_n, o) => {
    const { req, res, next } = call({ 'x-service-assertion': assertion(o) });
    await authenticateClawService(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('rejects a replayed assertion', async () => {
    mockRedis.set.mockResolvedValue(false);
    const { req, res, next } = call({ 'x-service-assertion': assertion() });
    await authenticateClawService(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('fails closed (503) when the replay check is unavailable', async () => {
    mockRedis.set.mockRejectedValue(new Error('redis down'));
    const { req, res, next } = call({ 'x-service-assertion': assertion() });
    await authenticateClawService(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });
  it('rejects an assertion signed by Spaces itself (Spaces must not be able to mint them)', async () => {
    const { req, res, next } = call({ 'x-service-assertion': assertion({}, spaces.privateKey, 'claw-1') });
    await authenticateClawService(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('issueAgentToken', () => {
  it('agent mode: scopes are the agent grants, sub is the bot', async () => {
    const t = await issueAgentToken({ principalId: 'p1' });
    expect(t.actingUserId).toBe('bot1');
    expect(t.scopes).toEqual(['chat:write', 'channels:read']);
    expect(looksLikeAgentToken(t.token)).toBe(true);
    const v = verifyEs256(t.token, spacesPublicKey, { issuer: 'xyne-spaces', audience: 'xyne-spaces-api', maxLifetimeSeconds: 700, typ: 'claw-agent+jwt' });
    expect(typeof v === 'object' && v.payload).toMatchObject({ sub: 'bot1', pid: 'p1', ws: 'ws1', obo: false });
  });
  it('refuses a disabled agent', async () => {
    mockPrincipals['p1']!.status = 'DISABLED';
    await expect(issueAgentToken({ principalId: 'p1' })).rejects.toMatchObject({ status: 404 });
  });
  it('refuses an agent with no approved scopes', async () => {
    mockAgentScopes['p1'] = [];
    await expect(issueAgentToken({ principalId: 'p1' })).rejects.toMatchObject({ status: 403 });
  });
  it('on behalf of a user in a live interaction: needs a valid delegation token for that user', async () => {
    const proof = mintClawDelegationToken({ spacesUserId: 'alice', workspaceId: 'ws1' });
    const t = await issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice', delegationToken: proof } });
    expect(t.actingUserId).toBe('alice');
    expect(t.onBehalfOf).toBe(true);
  });
  it('on behalf of a user with no live proof and no delegation: refused', async () => {
    await expect(issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice' } })).rejects.toMatchObject({ status: 403 });
  });
  it("a delegation token for someone else does not count as alice's", async () => {
    const proof = mintClawDelegationToken({ spacesUserId: 'bob', workspaceId: 'ws1' });
    await expect(issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice', delegationToken: proof } })).rejects.toMatchObject({ status: 403 });
  });
  it('stored delegation: scopes are the delegation capped by the agent grants', async () => {
    mockDelegations['p1|alice'] = ['chat:write', 'tickets:write'];
    const t = await issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice' } });
    expect(t.scopes).toEqual(['chat:write']);
  });
  it("live proof that names another agent doesn't count for this one", async () => {
    mockPrincipals['p2'] = { ...mockPrincipals['p1']!, id: 'p2', botUserId: 'bot2' };
    mockAgentScopes['p2'] = mockAgentScopes['p1'] ?? [];
    const forP2 = mintClawDelegationToken({ spacesUserId: 'alice', workspaceId: 'ws1', purpose: 'session:p2' });
    await expect(issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice', delegationToken: forP2 } })).rejects.toMatchObject({ status: 403 });
    const t = now();
    const eventForP2 = signEs256(
      { iss: 'xyne-spaces', aud: 'xyne-claw-auth', sub: 'alice', ws: 'ws1', pid: 'p2', prp: 'event:APP_MENTION', iat: t, exp: t + 60, jti: 'e1' },
      spaces.privateKey, 'spaces-1', 'claw-event+jwt'
    );
    await expect(issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice', delegationToken: eventForP2 } })).rejects.toMatchObject({ status: 403 });
    const forP1 = mintClawDelegationToken({ spacesUserId: 'alice', workspaceId: 'ws1', purpose: 'session:p1' });
    await expect(issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice', delegationToken: forP1 } })).resolves.toMatchObject({ onBehalfOf: true });
  });
  it('refuses a user from another workspace', async () => {
    const proof = mintClawDelegationToken({ spacesUserId: 'mallory', workspaceId: 'ws2' });
    await expect(issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'mallory', delegationToken: proof } })).rejects.toMatchObject({ status: 403 });
  });
});

describe('authenticateClawAgent', () => {
  async function authed(token: string) {
    const { req, res, next } = call({ authorization: `Bearer ${token}` }, 'POST', '/api/claw-agents/bot/chat/postMessage');
    await authenticateClawAgent(req, res, next);
    return { req, res, next };
  }
  it('sets req.user to the bot and permissions to the current grants', async () => {
    const t = await issueAgentToken({ principalId: 'p1' });
    const { req, next } = await authed(t.token);
    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe('bot1');
    expect((req as any).auth).toMatchObject({ appId: 'p1', permissions: ['chat:write', 'channels:read'] });
  });
  it('refuses on-behalf-of tokens: the bot API is the agent acting as itself', async () => {
    const proof = mintClawDelegationToken({ spacesUserId: 'alice', workspaceId: 'ws1' });
    const t = await issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice', delegationToken: proof } });
    const { res, next } = await authed(t.token);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('rejects a token signed by any other key', async () => {
    const t = now();
    const forged = signEs256(
      { iss: 'xyne-spaces', aud: 'xyne-spaces-api', sub: 'alice', pid: 'p1', ws: 'ws1', scp: ['chat:write'], obo: true, iat: t, exp: t + 60, jti: 'x' },
      stranger.privateKey,
      'spaces-1',
      'claw-agent+jwt'
    );
    const { res, next } = await authed(forged);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

import { requiredScopeFor, CLAW_ROUTE_SCOPES, type RouteScopeRule } from './routeScopes';
import { authenticateClawAgentOnBehalfOf } from './tokens';

describe('requiredScopeFor', () => {
  const rules: RouteScopeRule[] = [
    { method: 'GET', path: '/api/channels/*', scope: 'channels:read' },
    { method: 'GET', path: '/api/channels/:id/members', scope: 'users:read' },
    { method: 'POST', path: '/api/messages', scope: 'chat:write' },
  ];
  it('matches exact, param and wildcard rules, most specific first', () => {
    expect(requiredScopeFor('GET', '/api/channels', rules)).toBe('channels:read');
    expect(requiredScopeFor('GET', '/api/channels/c1/messages?limit=5', rules)).toBe('channels:read');
    expect(requiredScopeFor('GET', '/api/channels/c1/members', rules)).toBe('users:read');
    expect(requiredScopeFor('POST', '/api/messages', rules)).toBe('chat:write');
  });
  it('denies by default: other methods and unlisted routes have no scope', () => {
    expect(requiredScopeFor('DELETE', '/api/channels/c1', rules)).toBeUndefined();
    expect(requiredScopeFor('POST', '/api/messages/x/delete', rules)).toBeUndefined();
    expect(requiredScopeFor('GET', '/api/admin/users', rules)).toBeUndefined();
    expect(requiredScopeFor('GET', '/api/channelsX', rules)).toBeUndefined();
  });
});

describe('authenticateClawAgentOnBehalfOf (user routes)', () => {
  const added: RouteScopeRule[] = [{ method: 'GET', path: '/api/channels/*', scope: 'channels:read' }];
  let original: RouteScopeRule[] = [];
  beforeAll(() => {
    original = [...CLAW_ROUTE_SCOPES];
    CLAW_ROUTE_SCOPES.push(...added);
  });
  afterAll(() => {
    CLAW_ROUTE_SCOPES.splice(0, CLAW_ROUTE_SCOPES.length, ...original);
  });

  async function onUserRoute(token: string, method: string, url: string) {
    const { req, res, next } = call({ authorization: `Bearer ${token}` }, method, url);
    await authenticateClawAgentOnBehalfOf(req, res, next);
    return { req, res, next };
  }
  async function aliceToken() {
    const proof = mintClawDelegationToken({ spacesUserId: 'alice', workspaceId: 'ws1' });
    return (await issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice', delegationToken: proof } })).token;
  }

  it('runs as the user on a listed route with a granted scope', async () => {
    const { req, next } = await onUserRoute(await aliceToken(), 'GET', '/api/channels/c1');
    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe('alice');
    expect((req as any).auth.clawAgent).toMatchObject({ principalId: 'p1', onBehalfOfUserId: 'alice' });
  });
  it('403 on a route not open to agents, even though the user could call it', async () => {
    const { res, next } = await onUserRoute(await aliceToken(), 'GET', '/api/admin/users');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it('403 when the token lacks the scope the route needs', async () => {
    CLAW_ROUTE_SCOPES.push({ method: 'POST', path: '/api/tickets', scope: 'tickets:write' });
    const { res } = await onUserRoute(await aliceToken(), 'POST', '/api/tickets');
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it('401 for an agent-as-itself token on user routes', async () => {
    const t = await issueAgentToken({ principalId: 'p1' });
    const { res, next } = await onUserRoute(t.token, 'GET', '/api/channels/c1');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('401 once the agent is disabled', async () => {
    const token = await aliceToken();
    mockPrincipals['p1']!.status = 'DISABLED';
    // bypass the 30s scope cache for this principal/user pair
    jest.resetModules();
    const fresh = await import('./tokens');
    const { req, res, next } = call({ authorization: `Bearer ${token}` }, 'GET', '/api/channels/c1');
    await fresh.authenticateClawAgentOnBehalfOf(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('CLAW_ROUTE_SCOPES (real map)', () => {
  const { CLAW_ROUTE_SCOPES: real, requiredScopeFor: req } = jest.requireActual('./routeScopes') as typeof import('./routeScopes');
  it.each([
    ['POST', '/api/conversations/c1/messages', 'chat:write'],
    ['PATCH', '/api/tickets/t1', 'tickets:write'],
    ['GET', '/api/tickets/board-fields?boardId=b', 'tickets:read'],
    ['GET', '/api/automations/schema/triggers/x', 'automations:read'],
    ['GET', '/api/automations/runs/r1', 'automations:read'],
    ['GET', '/api/automations/a1', 'automations:read'],
    ['DELETE', '/api/automations/a1', 'automations:write'],
    ['GET', '/api/sdlc/repositories/context?q=x', 'sdlc:read'],
    ['GET', '/api/sdlc/repositories/r1/context', 'sdlc:read'],
  ])('%s %s needs %s', (m, path, scope) => {
    expect(req(m, path, real)).toBe(scope);
  });
  it.each([
    ['POST', '/api/query'],
    ['POST', '/api/query/claw'],
    ['GET', '/api/auth/refresh-session'],
    ['POST', '/api/auth/logout'],
    ['DELETE', '/api/tickets/t1'],
    ['GET', '/api/admin/settings'],
    ['POST', '/api/internal/postAsUser'],
    ['GET', '/api/users'],
  ])('%s %s is not open to agents', (m, path) => {
    expect(req(m, path, real)).toBeUndefined();
  });
});

describe('renewal tokens', () => {
  it('a live interaction returns a renewal token that later works without a fresh proof', async () => {
    const proof = mintClawDelegationToken({ spacesUserId: 'alice', workspaceId: 'ws1' });
    const first = await issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice', delegationToken: proof } });
    expect(first.renewalToken).toBeDefined();
    const second = await issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice', renewalToken: first.renewalToken } });
    expect(second.actingUserId).toBe('alice');
    expect(second.renewalToken).toBeUndefined(); // never extended
  });
  it("alice's renewal token does not work for bob, or for another agent", async () => {
    const proof = mintClawDelegationToken({ spacesUserId: 'alice', workspaceId: 'ws1' });
    const { renewalToken } = await issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice', delegationToken: proof } });
    mockUsers['bob'] = { ...mockUsers['alice']!, id: 'bob' };
    await expect(issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'bob', renewalToken } })).rejects.toMatchObject({ status: 403 });
    mockPrincipals['p2'] = { ...mockPrincipals['p1']!, id: 'p2', botUserId: 'bot2' };
    mockAgentScopes['p2'] = ['chat:write'];
    await expect(issueAgentToken({ principalId: 'p2', onBehalfOf: { userId: 'alice', renewalToken } })).rejects.toMatchObject({ status: 403 });
  });
  it('a stored delegation does not mint renewal tokens', async () => {
    mockDelegations['p1|alice'] = ['chat:write'];
    const t = await issueAgentToken({ principalId: 'p1', onBehalfOf: { userId: 'alice' } });
    expect(t.renewalToken).toBeUndefined();
  });
});

describe('CLAW_ROUTE_SCOPES never opens the proof route to agents', () => {
  const { requiredScopeFor: req } = jest.requireActual('./routeScopes') as typeof import('./routeScopes');
  it('POST /api/claw-agents/delegation-token is not agent-callable', () => {
    expect(req('POST', '/api/claw-agents/delegation-token')).toBeUndefined();
    expect(req('POST', '/api/claw-agents/service/token')).toBeUndefined();
  });
});
