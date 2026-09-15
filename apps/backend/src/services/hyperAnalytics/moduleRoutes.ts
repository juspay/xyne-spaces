/**
 * Whitelist of module paths worth counting as a "module open".
 */

/**
 * Modules whose bare path is the pathname the router settles on. Deeper paths
 * under these are conversations/records, not module opens, and are dropped:
 *   /chat/dm            -> /chat/dm
 *   /chat/dm/conv_123   -> dropped
 *   /projects/p1/b2/t3  -> dropped
 */
const EXACT_MODULES = new Set([
  '/ai/chat/new',
  '/ai/library',
  '/ai/knowledge',
  '/ai/digital-twin',
  '/ai/metrics',
  '/ai/workflow',
  '/onboarding',
  '/rca',
  '/chat/dm',
  '/chat/bookmarks',
  '/chat/drafts-sent',
  '/chat/canvas',
  '/chat/activity',
  '/chat/search',
  '/chat/dir/recap',
  '/chat/dir/threads',
  '/chat/dir/unreads',
  '/chat/dir/canvas',
  '/chat/dir/my-tickets',
  '/support/all',
  '/search-results',
  '/product-insights',
  '/agents',
  '/claw-agents',
  '/knowledge-base',
  '/memory',
  '/analytics',
  '/analytics-dashboard',
  '/dashboards',
  '/projects',
  '/team-intelligence',
  '/user-groups',
  '/listProjects',
  '/calls',
  '/recordings',
  '/browser',
  '/workspace-management',
  '/organisations',
  '/forms',
  '/scheduled-messages',
  '/automations',
  '/apps',
  '/resource-access',
  '/roles',
  '/jira-migration',
  '/migration/confluence',
  '/migration/whatsapp',
  '/guide',
  '/daily-brief',
]);

/**
 * Top-level routes outside the /:workspaceId subtree (AppRoot.tsx:1435+).
 * Their first segment is not a workspace id, so they are skipped rather than
 * recorded against a bogus workspace.
 */
const NON_WORKSPACE_ROOTS = new Set([
  'newWindow',
  'auth',
  'invite',
  'community',
  'workspaces',
  'no-access',
  'launch',
  'system',
  'redirected',
  'call',
]);

export interface ResolvedModule {
  module: string;
  workspaceId: string;
}

/**
 * Resolves a workspace-prefixed pathname (`/${workspaceId}${path}`) to a
 * whitelisted module, or null when the page is not one we count.
 *
 */
export function resolveModule(page: string): ResolvedModule | null {
  const parts = page.split('/').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const [workspaceId, ...rest] = parts;
  if (!workspaceId || NON_WORKSPACE_ROOTS.has(workspaceId)) {
    return null;
  }

  const candidate = `/${rest.join('/')}`;

  return EXACT_MODULES.has(candidate) ? { module: candidate, workspaceId } : null;
}
