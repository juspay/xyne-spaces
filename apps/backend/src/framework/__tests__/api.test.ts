import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { defineRequestContract, defineRoute } from '@xyne/shared';

const mockConfig = {
  env: 'test',
  cors: { origin: '*' },
  internal: { transitProxyIngressEnabled: false },
  enc: { apiClientEncryptionEnabled: false, enableDbEncryption: false },
};
jest.mock('@/config/env', () => ({ config: mockConfig }));
jest.mock('@/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('@/middleware/auth', () => ({
  authMiddleware: {
    authenticate: (req: Request, res: Response, next: NextFunction) => {
      const id = req.headers['x-test-user'];
      if (typeof id !== 'string') {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      req.user = { id, workspaceId: 'ws-1' } as Request['user'];
      next();
    },
  },
}));
// The steps every request gets in createApp, as pass-throughs (they need Redis/DB/OTel).
jest.mock('@/middleware/metricsMiddleware', () => ({ metricsMiddleware: (_q: unknown, _s: unknown, next: () => void) => next() }));
jest.mock('@/middleware/requestLogger', () => ({ requestLogger: (_q: unknown, _s: unknown, next: () => void) => next() }));
jest.mock('@/database/tenant/context', () => ({ tenantScopeMiddleware: (_q: unknown, _s: unknown, next: () => void) => next() }));
// Response encryption step: marks the responses it saw.
jest.mock('@/middleware/decryptionMiddleware', () => ({
  encryptResponseBodyMiddleware: (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-test-response-encryption', '1');
    next();
  },
}));
jest.mock('@/apps/middelware/authenticator', () => ({
  TRANSIT_PROXY_HEADER: 'x-xyne-transit-proxy',
  parseTransitProxyHeader: (value: unknown) => (value === 'ingress;1' ? { role: 'ingress', version: 1 } : undefined),
  authenticateApp: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 'bot-1', workspaceId: 'ws-1' } as Request['user'];
    (req as Request & { auth?: unknown }).auth = {
      appId: 'app1',
      installedAppId: 'inst-1',
      permissions: String(req.headers['x-test-scopes'] ?? '').split(',').filter(Boolean),
      permissionsStale: false,
    };
    next();
  },
}));
// Slack-compatible login: logs the bot in like authenticateApp and answers errors the Slack way
// (200 `{ ok: false, ... }`), as slackAuthenticateApp does.
jest.mock('@/apps/platform-adapters/slack/middleware', () => ({
  slackAuthenticateApp: (req: Request, res: Response, next: NextFunction) => {
    const originalStatus = res.status.bind(res);
    const originalJson = res.json.bind(res);
    let statusCode = 200;
    res.status = ((code: number) => {
      statusCode = code;
      return originalStatus(code);
    }) as Response['status'];
    res.json = ((body?: unknown) => {
      if (statusCode >= 400) {
        originalStatus(200);
        return originalJson({ ok: false, ...(body as object) });
      }
      return originalJson(body);
    }) as Response['json'];
    req.user = { id: 'bot-1', workspaceId: 'ws-1' } as Request['user'];
    next();
  },
}));
// Stand-in for the encryption pipeline: records that it ran and hands over derived facts.
const encryptionRuns: string[] = [];
jest.mock('@/middleware/encryptedRoute', () => ({
  // Keeps the real rule: no steps for proxy routes where the proxy is not deployed.
  encryptedRoute: (_contract: unknown, options: { transitProxyIngress?: boolean }) =>
    options.transitProxyIngress && !mockConfig.internal.transitProxyIngressEnabled ? [] : [
    (req: Request, _res: Response, next: NextFunction) => {
      encryptionRuns.push(req.path);
      req.derived = { version: 2, fields: { note: { userIds: ['u-9'] } } } as Request['derived'];
      next();
    },
  ],
}));

import { api, ContractError, mountTypedRoutes, type AccessCheck } from '../api';
import { createApp } from '../createApp';
import { contractGate, findContract } from '../contractGate';

/** createApp, plus what app.ts adds after it (untyped routes): must never run for typed requests. */
function makeApp(withGate = true) {
  const app = withGate ? createApp() : express();
  if (!withGate) mountTypedRoutes(app);
  app.use((_req, res, next) => {
    res.setHeader('x-test-app-ts', '1');
    next();
  });
  app.post('/api/legacy/ping', express.json(), (req, res) => {
    res.json({ legacy: true, body: req.body });
  });
  return app;
}

const noteEncryption = defineRequestContract({ schema: z.object({ note: z.string().optional() }) });

const echo = defineRoute({
  method: 'POST',
  path: '/test/echo/:id',
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: z.object({ name: z.string().trim().min(1), note: z.string().optional() }),
  response: z.object({ id: z.string(), name: z.string(), keys: z.array(z.string()), user: z.string().nullable() }),
});
api.route(echo, {
  handle: async ({ params, body, user }) => ({ id: params.id, name: body.name, keys: Object.keys(body), user: user?.id ?? null }),
});

const seen: unknown[] = [];
const channelCheck: AccessCheck<{ channelId: string }> = async ({ body }) => {
  seen.push(body);
  const { channelId } = body as { channelId: string };
  if (channelId === 'forbidden') throw new ContractError(403, { error: 'Forbidden', message: 'no access' });
  return { channelId: `resolved-${channelId}` };
};

const appGroup = {
  post: defineRoute({
    method: 'POST',
    path: '/test/apps/post',
    body: z.object({ channelId: z.string().min(1), note: z.string().optional() }),
    response: z.object({ channel: z.string(), app: z.string().nullable(), facts: z.array(z.string()) }),
    encryption: noteEncryption,
  }),
  fail: defineRoute({
    method: 'GET',
    path: '/test/apps/fail',
    response: z.object({}),
  }),
} as const;
api.routes(appGroup, (serve) => ({
  post: serve('post', {
    auth: 'app',
    access: { channel: channelCheck },
    encryption: { resolveWorkspaceId: async () => 'ws-1' },
    successStatus: 201,
    handle: async ({ access, app, derived }) => ({
      channel: access.channel.channelId,
      app: app?.appId ?? null,
      facts: (derived?.fields as Record<string, { userIds?: string[] }> | undefined)?.note?.userIds ?? [],
    }),
  }),
  fail: serve('fail', {
    auth: 'public',
    handle: async () => {
      throw new ContractError(409, { error: 'Conflict', code: 'TEST_CONFLICT' });
    },
  }),
}));

const sessionEncrypted = defineRoute({
  method: 'PUT',
  path: '/test/session/note',
  body: z.object({ note: z.string() }),
  response: z.object({ ok: z.boolean() }),
  encryption: noteEncryption,
});
api.route(sessionEncrypted, {
  encryption: { resolveWorkspaceId: async () => 'ws-1' },
  handle: async () => ({ ok: true }),
});

api.route(defineRoute({ method: 'GET', path: '/test/boom', response: z.object({}) }), {
  auth: 'public',
  handle: async () => {
    throw new Error('boom');
  },
});

const slackStyle = defineRoute({
  method: 'POST',
  path: '/test/slack/chat.thing',
  body: z.object({ ts: z.string().min(1) }),
  response: z.object({ ok: z.literal(true), ts: z.string() }),
});
api.route(slackStyle, {
  auth: 'slack-app',
  invalidRequest: () => new ContractError(200, { ok: false, error: 'invalid_arguments' }),
  access: {
    gone: async ({ body }: { body: unknown }) => {
      if ((body as { ts: string }).ts === 'gone') throw new ContractError(404, { error: 'message_not_found' });
    },
  },
  handle: async ({ body }) => ({ ok: true as const, ts: body.ts }),
});

beforeEach(() => {
  encryptionRuns.length = 0;
  seen.length = 0;
  mockConfig.internal.transitProxyIngressEnabled = false;
});

describe('contract gate matching', () => {
  it('matches the exact address, strict and case-sensitive, like Express', () => {
    expect(findContract('POST', '/api/test/echo/42')).toBe(echo);
    expect(findContract('POST', '/api/test/echo/42/')).toBeUndefined();
    expect(findContract('POST', '/api/Test/echo/42')).toBeUndefined();
    expect(findContract('POST', '/api/test/echo')).toBeUndefined();
    expect(findContract('GET', '/api/test/echo/42')).toBeUndefined();
  });

  it('answers HEAD from the GET contract', () => {
    expect(findContract('HEAD', '/api/test/apps/fail')).toBe(appGroup.fail);
  });
});

describe('contract gate', () => {
  function gated(enforce: boolean) {
    const app = express();
    app.use(contractGate({ enforce }));
    app.use((req, res) => {
      res.json({ contract: req.apiContract?.key ?? null });
    });
    return app;
  }

  it('tags typed requests and lets untyped ones through while not enforcing', async () => {
    expect((await request(gated(false)).post('/api/test/echo/1')).body).toEqual({ contract: 'POST /test/echo/:id' });
    expect((await request(gated(false)).get('/api/legacy/thing')).body).toEqual({ contract: null });
  });

  it('passes OPTIONS (CORS preflight) through untagged', async () => {
    const res = await request(gated(true)).options('/api/test/echo/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contract: null });
  });

  it('when enforcing, answers 404 for untyped /api addresses in any case, and leaves other paths alone', async () => {
    expect((await request(gated(true)).get('/api/legacy/thing')).status).toBe(404);
    expect((await request(gated(true)).get('/API/legacy/thing')).status).toBe(404);
    expect((await request(gated(true)).post('/api/test/echo/1')).status).toBe(200);
    expect((await request(gated(true)).get('/health')).status).toBe(200);
  });
});

describe('typed routes', () => {
  it('hands the handler the checked body (trimmed, unknown keys dropped), default session login', async () => {
    const res = await request(makeApp())
      .post('/api/test/echo/42')
      .set('x-test-user', 'u-1')
      .send({ name: '  Ada  ', extra: 'dropped' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '42', name: 'Ada', keys: ['name'], user: 'u-1' });
  });

  it('requires session login by default', async () => {
    const res = await request(makeApp()).post('/api/test/echo/42').send({ name: 'Ada' });
    expect(res.status).toBe(401);
  });

  it('answers 400 VALIDATION_ERROR for a body or params that break the contract', async () => {
    const bad = await request(makeApp()).post('/api/test/echo/42').set('x-test-user', 'u-1').send({ name: '' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'Validation error', code: 'VALIDATION_ERROR' });
    const badParam = await request(makeApp()).post('/api/test/echo/abc').set('x-test-user', 'u-1').send({ name: 'Ada' });
    expect(badParam.status).toBe(400);
  });

  it('does not serve other cases or a trailing slash', async () => {
    const app = makeApp();
    expect((await request(app).post('/api/test/echo/42/').set('x-test-user', 'u-1').send({ name: 'a' })).status).toBe(404);
    expect((await request(app).post('/api/TEST/echo/42').set('x-test-user', 'u-1').send({ name: 'a' })).status).toBe(404);
  });

  it('is not reachable without the contract gate', async () => {
    const res = await request(makeApp(false)).post('/api/test/echo/42').set('x-test-user', 'u-1').send({ name: 'Ada' });
    expect(res.status).toBe(404);
  });

  it('runs access checks after validation, on the checked body, and gives their results to the handler', async () => {
    const app = makeApp();
    const invalid = await request(app).post('/api/test/apps/post').send({ channelId: '' });
    expect(invalid.status).toBe(400);
    expect(seen).toHaveLength(0);

    const ok = await request(app).post('/api/test/apps/post').send({ channelId: 'c1', junk: true });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ channel: 'resolved-c1', app: 'app1', facts: [] });
    expect(seen).toEqual([{ channelId: 'c1' }]);

    const denied = await request(app).post('/api/test/apps/post').send({ channelId: 'forbidden' });
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: 'Forbidden', message: 'no access' });
  });

  it('sends a ContractError as its status and body', async () => {
    const res = await request(makeApp()).get('/api/test/apps/fail');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Conflict', code: 'TEST_CONFLICT' });
  });
});

describe('encryption pipeline', () => {
  it('always runs for session routes with an encryption contract', async () => {
    const res = await request(makeApp()).put('/api/test/session/note').set('x-test-user', 'u-1').send({ note: 'hi' });
    expect(res.status).toBe(200);
    expect(encryptionRuns).toEqual(['/test/session/note']);
  });

  // The flag is read when the route is mounted, like the branch's whenTransitProxyIngress.
  it('skips app routes when the ingress transit proxy is not deployed', async () => {
    const res = await request(makeApp()).post('/api/test/apps/post').send({ channelId: 'c1' });
    expect(res.status).toBe(201);
    expect(encryptionRuns).toEqual([]);
  });
});

describe('with the ingress transit proxy deployed', () => {
  it('/apps routes refuse calls that did not come through the proxy, and run the encryption pipeline', async () => {
    jest.resetModules();
    mockConfig.internal.transitProxyIngressEnabled = true;
    const { api: freshApi } = await import('../api');
    const { createApp: freshCreateApp } = await import('../createApp');
    const shared = await import('@xyne/shared');
    const contract = shared.defineRoute({
      method: 'POST',
      path: '/apps/test/proxied',
      body: z.object({ note: z.string().optional() }),
      response: z.object({ facts: z.array(z.string()) }),
      encryption: shared.defineRequestContract({ schema: z.object({ note: z.string().optional() }) }),
    });
    freshApi.route(contract, {
      auth: 'app',
      encryption: { resolveWorkspaceId: async () => 'ws-1' },
      handle: async ({ derived }) => ({
        facts: (derived?.fields as Record<string, { userIds?: string[] }> | undefined)?.note?.userIds ?? [],
      }),
    });
    const app = freshCreateApp();

    const direct = await request(app).post('/api/apps/test/proxied').send({ note: 'x' });
    expect(direct.status).toBe(403);
    expect(direct.body).toMatchObject({ code: 'TRANSIT_PROXY_REQUIRED' });
    expect(encryptionRuns).toEqual([]);

    const res = await request(app).post('/api/apps/test/proxied').set('x-xyne-transit-proxy', 'ingress;1').send({ note: 'x' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ facts: ['u-9'] });
    expect(encryptionRuns).toEqual(['/apps/test/proxied']);
  });
});

describe('Slack-compatible routes', () => {
  it('answer a body that breaks the contract with the route\'s invalidRequest, not the default 400', async () => {
    const res = await request(makeApp()).post('/api/test/slack/chat.thing').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, error: 'invalid_arguments' });
  });

  it('answer refusals the Slack way (HTTP 200, ok: false) and success as the handler returns it', async () => {
    const app = makeApp();
    const refused = await request(app).post('/api/test/slack/chat.thing').send({ ts: 'gone' });
    expect(refused.status).toBe(200);
    expect(refused.body).toEqual({ ok: false, error: 'message_not_found' });
    const ok = await request(app).post('/api/test/slack/chat.thing').send({ ts: '123.456' });
    expect(ok.body).toEqual({ ok: true, ts: '123.456' });
  });

  it('match a dotted Slack method name exactly', () => {
    expect(findContract('POST', '/api/test/slack/chat.thing')).toBe(slackStyle);
    expect(findContract('POST', '/api/test/slack/chatxthing')).toBeUndefined();
  });
});

describe('typed routes depend on nothing app.ts adds', () => {
  it('a typed request gets the common steps and its own, and never reaches what app.ts adds after createApp', async () => {
    const res = await request(makeApp()).post('/api/test/echo/42').set('x-test-user', 'u-1').send({ name: 'Ada' });
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff'); // helmet, from createApp
    expect(res.headers['x-test-response-encryption']).toBe('1'); // the route's own step
    expect(res.headers['x-test-app-ts']).toBeUndefined();
  });

  it('an untyped request goes on to what app.ts adds, with the common steps', async () => {
    const res = await request(makeApp()).post('/api/legacy/ping').send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ legacy: true, body: { a: 1 } });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-test-app-ts']).toBe('1');
  });

  it('an unexpected error gets the error answer inside the route', async () => {
    const res = await request(makeApp()).get('/api/test/boom');
    expect(res.status).toBe(500);
    expect(res.headers['x-test-app-ts']).toBeUndefined();
  });
});

// Type-level checks (tsc --noEmit): a group must serve every entry, each under its own name.
function typeChecks() {
  // @ts-expect-error `fail` is missing
  api.routes(appGroup, (serve) => ({
    post: serve('post', { auth: 'app', encryption: { resolveWorkspaceId: async () => 'ws' }, handle: async () => ({ channel: '', app: null, facts: [] }) }),
  }));
  api.routes(appGroup, (serve) => ({
    post: serve('post', { auth: 'app', encryption: { resolveWorkspaceId: async () => 'ws' }, handle: async () => ({ channel: '', app: null, facts: [] }) }),
    // @ts-expect-error built for `post`, mounted as `fail`
    fail: serve('post', { auth: 'app', encryption: { resolveWorkspaceId: async () => 'ws' }, handle: async () => ({ channel: '', app: null, facts: [] }) }),
  }));
  // @ts-expect-error a route with an encryption contract must say where its fields are stored
  api.route(sessionEncrypted, { handle: async () => ({ ok: true }) });
  api.route(echo, {
    // @ts-expect-error the handler gets no req
    handle: async ({ req }) => ({ id: req, name: '', keys: [], user: null }),
  });
}
void typeChecks;
