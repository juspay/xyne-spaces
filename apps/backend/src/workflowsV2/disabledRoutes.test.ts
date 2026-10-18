import { createWorkflowRouter } from '@xyne/workflow-sdk';
import { DISABLED_ROUTES } from './disabledRoutes';

describe('DISABLED_ROUTES', () => {
  // Built the same way router.ts builds them; route handlers are never called here.
  const keys = new Set(
    createWorkflowRouter({} as never, {
      authenticate: () => {
        throw new Error('unused');
      },
    }).map((r) => `${r.method} ${r.path}`),
  );

  it('blocks the credential test route', () => {
    expect(DISABLED_ROUTES.has('POST /credentials/:name/test')).toBe(true);
  });

  // Fails if an SDK bump renames a route, which would silently mount it again.
  it.each([...DISABLED_ROUTES])('%s still matches a route the SDK exposes', (key) => {
    expect(keys.has(key)).toBe(true);
  });

  it('leaves the other credential routes mounted', () => {
    for (const k of ['GET /credentials', 'POST /credentials', 'POST /credentials/:name/revoke']) {
      expect(keys.has(k)).toBe(true);
      expect(DISABLED_ROUTES.has(k)).toBe(false);
    }
  });
});
