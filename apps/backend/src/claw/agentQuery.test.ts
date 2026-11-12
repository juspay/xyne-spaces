import { readFileSync } from 'fs';
import { join } from 'path';
import type { Request, Response } from 'express';

const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockApplyToWhere = jest.fn(async (w: unknown) => ({ AND: [w ?? {}, { aclFor: 'alice' }] }));
jest.mock('@/database/client', () => ({
  readReplicaDb: {
    message: { findMany: (a: unknown) => mockFindMany(a), count: (a: unknown) => mockCount(a) },
    userActivityEvent: { findMany: (a: unknown) => mockFindMany(a), count: (a: unknown) => mockCount(a) },
  },
}));
jest.mock('@/database/acl', () => ({ ACLFactory: { getACL: jest.fn(() => ({ applyToWhere: mockApplyToWhere })) } }));
jest.mock('@/database/tenant/acl-extension', () => ({ isWorkspaceScopedModel: () => true }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { agentQueryRoutes, AGENT_QUERY_MODEL_SCOPES, AGENT_MAX_TAKE } from './agentQuery';
import { CLAW_ROUTE_SCOPES, ROUTE_ENFORCED } from './routeScopes';
import { ALLOWED_MODELS } from '@/services/pythonQuery';

const handler = (agentQueryRoutes as unknown as { stack: Array<{ route: { stack: Array<{ handle: Function }> } }> }).stack[0]!.route.stack[0]!.handle;

async function run(body: unknown, auth: unknown, user = { id: 'alice', workspaceId: 'ws1' }) {
  const req = { body, auth, user } as unknown as Request;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  await handler(req, res);
  return res as unknown as { status: jest.Mock; json: jest.Mock };
}
const agent = (permissions: string[]) => ({ permissions, clawAgent: { principalId: 'p1', onBehalfOfUserId: 'alice' } });

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue([{ id: 'm1', content: 'hi' }]);
  mockCount.mockResolvedValue(3);
});

describe('POST /api/agent-query', () => {
  it('refuses requests that are not an agent acting for the user', async () => {
    expect((await run({ model: 'message' }, undefined)).status).toHaveBeenCalledWith(403);
    expect((await run({ model: 'message' }, { permissions: ['channels:read'] })).status).toHaveBeenCalledWith(403);
    // token for alice, request user someone else
    expect((await run({ model: 'message' }, agent(['channels:read']), { id: 'bob', workspaceId: 'ws1' })).status).toHaveBeenCalledWith(403);
  });

  it('needs the scope for the queried model', async () => {
    const res = await run({ model: 'message' }, agent(['tickets:read']));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('refuses models not open to agents even if the user could query them', async () => {
    const res = await run({ model: 'notification' }, agent(['channels:read', 'users:read']));
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("runs with the user's ACL, scoped to the workspace, capped at AGENT_MAX_TAKE rows", async () => {
    const res = await run({ model: 'message', where: { conversationId: 'c1' }, take: 500 }, agent(['channels:read']));
    expect(res.status).not.toHaveBeenCalled();
    expect(mockApplyToWhere).toHaveBeenCalledWith({ conversationId: 'c1' });
    const args = mockFindMany.mock.calls[0]![0];
    expect(args.take).toBe(AGENT_MAX_TAKE);
    expect(args.where).toEqual({ AND: [{ AND: [{ conversationId: 'c1' }, { aclFor: 'alice' }] }, { workspaceId: 'ws1' }] });
  });

  it('removes session ids from activity rows', async () => {
    mockFindMany.mockResolvedValue([{ id: 'e1', sessionId: 'sess-secret', type: 'view' }]);
    const res = await run({ model: 'userActivityEvent', take: 1 }, agent(['activity:read']));
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'e1', type: 'view' }] });
  });

  it('count works under the same rules', async () => {
    const res = await run({ model: 'message', operation: 'count' }, agent(['channels:read']));
    expect(res.json).toHaveBeenCalledWith({ data: 3 });
  });
});

describe('agents can only filter on the queried model', () => {
  const alice = () => agent(['users:read', 'channels:read', 'activity:read']);

  it("refuses a relation filter that reads another model's secrets (session id oracle)", async () => {
    const res = await run(
      { model: 'user', operation: 'count', where: { id: 'admin1', sessions: { some: { status: 'ACTIVE', id: { gt: 'c' } } } } },
      alice()
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCount).not.toHaveBeenCalled();
  });

  it('refuses relation operators and related-model fields at any depth', async () => {
    for (const where of [
      { sessions: { some: { refreshToken: { startsWith: 'a' } } } },
      { OR: { sessions: { none: {} } } },
      { NOT: { profile: { is: { userId: 'x' } } } },
      { id: { not: { some: {} } } },
    ]) {
      const res = await run({ model: 'user', operation: 'count', where }, alice());
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockCount).not.toHaveBeenCalled();
  });

  it('refuses secret-like and stripped columns in where and orderBy', async () => {
    const bySession = await run({ model: 'userActivityEvent', where: { sessionId: { startsWith: 'a' } } }, alice());
    expect(bySession.status).toHaveBeenCalledWith(400);
    expect(bySession.json).toHaveBeenCalledWith({ error: 'field_not_allowed', field: 'sessionId' });
    const sorted = await run({ model: 'userActivityEvent', orderBy: [{ sessionId: 'asc' }] }, alice());
    expect(sorted.status).toHaveBeenCalledWith(400);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('still allows plain filters on the model, including AND/OR/NOT and not-operators', async () => {
    const res = await run(
      { model: 'message', where: { AND: { conversationId: 'c1' }, NOT: { content: { contains: 'x' } }, createdAt: { not: { lt: '2026-01-01' } } } },
      alice()
    );
    expect(res.json.mock.calls[0]?.[0]?.error ?? 'ok').toBe('ok');
    expect(res.status).not.toHaveBeenCalled();
    expect(mockFindMany).toHaveBeenCalled();
  });
});

describe('scope vocabulary is consistent', () => {
  const seed = readFileSync(join(__dirname, '../../scripts/seed-app-permissions.ts'), 'utf8');
  const registered = new Set([...seed.matchAll(/scope: '([^']+)'/g)].map((m) => m[1]));

  it('every route-map scope is a registered permission', () => {
    for (const r of CLAW_ROUTE_SCOPES) {
      if (r.scope === ROUTE_ENFORCED) continue;
      expect(registered).toContain(r.scope);
    }
  });
  it('every model-map scope is registered, and every model is queryable at all', () => {
    for (const [model, scope] of Object.entries(AGENT_QUERY_MODEL_SCOPES)) {
      expect(registered).toContain(scope);
      expect(ALLOWED_MODELS.has(model)).toBe(true);
    }
  });
});
