jest.mock('@xyne/shared', () => ({ OrgRole: { OWNER: 'OWNER', ADMIN: 'ADMIN' }, WorkspaceRole: { OWNER: 'OWNER', ADMIN: 'ADMIN' } }));
jest.mock('@/middleware/auth', () => ({
  authMiddleware: { authenticate: jest.fn(), requireAdminOrOwner: jest.fn() },
}));
jest.mock('./serviceAuth', () => ({ authenticateClawService: jest.fn() }));
jest.mock('@/middleware/upload', () => ({ uploadConfig: { single: jest.fn(() => jest.fn()) } }));
jest.mock('@/services/userManagementService', () => ({ UserManagementService: { getInstance: jest.fn() } }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('@/services/clawDelegationToken', () => ({ mintClawDelegationToken: jest.fn() }));
jest.mock('./tokens', () => ({ issueAgentToken: jest.fn() }));
jest.mock('./botRoutes', () => ({ clawBotRoutes: jest.fn() }));
jest.mock('./principals', () => ({ ClawAgentError: class extends Error {} }));
jest.mock('./directory', () => ({}));

import { authMiddleware } from '@/middleware/auth';
import { authenticateClawService } from './serviceAuth';
import { clawAgentRoutes } from './routes';

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } };
const stack = (clawAgentRoutes as unknown as { stack: Layer[] }).stack;
const route = (method: string, path: string) =>
  stack.find((l) => l.route?.path === path && l.route.methods[method])?.route?.stack.map((s) => s.handle) ?? [];

describe('adding an agent to a workspace', () => {
  it('needs a workspace admin AND claw-auth vouching for the agent', () => {
    const handlers = route('post', '/principals');
    expect(handlers).toContain(authMiddleware.requireAdminOrOwner);
    expect(handlers).toContain(authenticateClawService);
  });
  it('the bot picture is admin-only', () => {
    expect(route('post', '/principals/:id/picture')).toContain(authMiddleware.requireAdminOrOwner);
  });
  it('service lookups stay service-only (incl. the directory)', () => {
    for (const [m, p] of [['get', '/service/principals'], ['get', '/service/principals/:id'], ['post', '/service/token'], ['get', '/service/users/:id'], ['get', '/service/users'], ['get', '/service/groups']] as const) {
      expect(route(m, p)).toContain(authenticateClawService);
    }
  });
});
