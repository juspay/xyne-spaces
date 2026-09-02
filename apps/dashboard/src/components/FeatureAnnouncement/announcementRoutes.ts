/**
 * Routes that are a step on the way into the product rather than the product itself. An
 * announcement is for someone already using the app; interrupting a setup flow is noise,
 * and it burns the once-per-user delivery on a moment they were not paying attention.
 */
const SETUP_ROUTES = new Set(['onboarding', 'slack-migration', 'workspace-selection']);

/**
 * Every in-app route is `/:workspaceId/<section>/...`, so the section is the second
 * segment. Matched exactly rather than by substring: a channel or file named "onboarding"
 * must not silently suppress announcements everywhere it appears in a path.
 *
 * Dependency-free on purpose, so it can be tested without a React renderer.
 */
export function isAnnouncementRoute(pathname: string): boolean {
  const [workspaceId, section] = pathname.split('/').filter(Boolean);
  if (!workspaceId) return false;
  return !section || !SETUP_ROUTES.has(section);
}
