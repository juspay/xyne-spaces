import express from 'express';
import request from 'supertest';

/**
 * Per-endpoint contract tests for the shared backfill guard (XYNE-55063):
 *   - anonymous            -> 401
 *   - authenticated, no ADMIN grant -> 403
 *   - authenticated ADMIN  -> 200
 *
 * We exercise the REAL `backfillAdminAuth` array and the REAL `authorize`
 * decision logic, mocking only the edges: `authMiddleware.authenticate` (so a
 * request is "logged in" via a header) and the database/repository layer that
 * `authorize` consults. No live server or DB is required.
 */

// authenticate: a request is authenticated iff it carries `x-test-user`.
jest.mock('@/middleware/auth', () => ({
  authMiddleware: {
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const uid = req.headers['x-test-user'] as string | undefined;
      if (!uid) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      // Minimal user shape; authorize() only reads `.id`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).user = { id: uid };
      next();
    },
  },
}));

// DatabaseClient.getInstance().resource.findUnique — resolves the Resource row.
const mockResourceFindUnique = jest.fn();
jest.mock('@/database/client', () => ({
  DatabaseClient: { getInstance: () => ({ resource: { findUnique: mockResourceFindUnique } }) },
}));

// repositories.resourceAccess.hasAccess — the ACL check.
const mockHasAccess = jest.fn();
jest.mock('@/database/repositories/index', () => ({
  repositories: { resourceAccess: { hasAccess: mockHasAccess } },
}));

// Imported AFTER the mocks are declared (jest hoists jest.mock above imports).
import { backfillAdminAuth, backfillMountGuard } from '@/middleware/backfillAdminAuth';

function appWithSharedGuard() {
  const app = express();
  app.use(express.json());
  app.post('/run', ...backfillAdminAuth, (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

function appWithMountGuard() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', backfillMountGuard);
  // Every mounted "router" here just echoes 200 so we can observe whether the
  // mount guard let the request through or short-circuited it.
  app.post('/api/admin/:name', (req, res) => res.status(200).json({ name: req.params.name }));
  return app;
}

beforeEach(() => {
  mockResourceFindUnique.mockReset();
  mockHasAccess.mockReset();
  // Default: the TICKET-MIGRATION resource row exists.
  mockResourceFindUnique.mockResolvedValue({ id: 'res_ticket_migration', name: 'TICKET-MIGRATION' });
});

describe('backfillAdminAuth shared guard', () => {
  it('rejects an anonymous request with 401', async () => {
    const res = await request(appWithSharedGuard()).post('/run');
    expect(res.status).toBe(401);
    expect(mockHasAccess).not.toHaveBeenCalled();
  });

  it('rejects an authenticated non-admin with 403', async () => {
    mockHasAccess.mockResolvedValue(false);
    const res = await request(appWithSharedGuard()).post('/run').set('x-test-user', 'user_1');
    expect(res.status).toBe(403);
    expect(mockHasAccess).toHaveBeenCalledWith('user_1', 'res_ticket_migration', 'ADMIN');
  });

  it('allows an authenticated admin with 200', async () => {
    mockHasAccess.mockResolvedValue(true);
    const res = await request(appWithSharedGuard()).post('/run').set('x-test-user', 'admin_1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 403 when the resource row is missing (unconfigured environment)', async () => {
    mockResourceFindUnique.mockResolvedValue(null);
    mockHasAccess.mockResolvedValue(true);
    const res = await request(appWithSharedGuard()).post('/run').set('x-test-user', 'admin_1');
    expect(res.status).toBe(403);
  });
});

describe('backfillMountGuard mount-layer default', () => {
  it('gates a *-backfill path by default (anonymous -> 401)', async () => {
    const res = await request(appWithMountGuard()).post('/api/admin/brand-new-backfill');
    expect(res.status).toBe(401);
  });

  it('gates a *-backfill path by default (admin -> 200)', async () => {
    mockHasAccess.mockResolvedValue(true);
    const res = await request(appWithMountGuard())
      .post('/api/admin/brand-new-backfill')
      .set('x-test-user', 'admin_1');
    expect(res.status).toBe(200);
  });

  it('does NOT gate a self-guarded backfill (defers to the router own resource)', async () => {
    // vespa-backfill authorizes against VESPA in its own router, so the mount
    // guard must let it through untouched — an anonymous request reaches the
    // stub handler here (in production the router itself would 401/403).
    const res = await request(appWithMountGuard()).post('/api/admin/vespa-backfill');
    expect(res.status).toBe(200);
    expect(mockHasAccess).not.toHaveBeenCalled();
  });

  it('does NOT gate a non-backfill admin route', async () => {
    const res = await request(appWithMountGuard()).post('/api/admin/product-insights-recluster');
    expect(res.status).toBe(200);
    expect(mockHasAccess).not.toHaveBeenCalled();
  });
});
