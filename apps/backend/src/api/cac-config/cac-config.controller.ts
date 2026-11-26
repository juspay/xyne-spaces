import type { IncomingHttpHeaders } from 'node:http';
import { CacConfigService } from '@/services/cacConfigService';
import type { AuthenticatedUser } from '@/types/express';

/**
 * CAC config, sub-ticket links and conversation labels on the typed framework: no req/res, same
 * answers as the controllers and route handlers they replace.
 */

// ─── CAC config ─────────────────────────────────────────────────────────────

/** GET /cac-config/:key: the Superposition context is the caller's email, workspace and (playground) environment. */
export async function cacConfig(input: { params: { key: string }; user: AuthenticatedUser | undefined; headers: IncomingHttpHeaders }) {
  const email = input.user?.email?.trim();
  const workspaceId = input.user?.workspaceId;
  const routeEnv = input.headers['x-route-env'];
  const isPlayground = (Array.isArray(routeEnv) ? routeEnv[0] : routeEnv)?.trim().toLowerCase() === 'playground';
  const context = {
    ...(email ? { email } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(isPlayground ? { environment: 'playground' } : {}),
  };
  return { key: input.params.key, config: await CacConfigService.fetch(input.params.key, context) };
}