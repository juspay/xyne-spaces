/** Request path as rules name it: no query string, no `/api` prefix. */
export function normalizeRequestPath(path: string): string {
  return path.split('?')[0].replace(/^\/api(?=\/|$)/, '');
}

/**
 * Whether `route` ("<METHOD> <path>") matches `method` + an already-normalized `path`;
 * `:param` segments match any non-empty segment. Shared by manifest rules and contracts
 * so client and server match identically.
 */
export function matchesRoute(route: string, method: string, path: string): boolean {
  const [routeMethod, routePath] = route.split(' ');
  if (!routePath || routeMethod.toUpperCase() !== method.toUpperCase()) return false;

  const routeSegments = routePath.split('/');
  const pathSegments = path.split('/');
  if (routeSegments.length !== pathSegments.length) return false;

  return routeSegments.every((segment, i) =>
    segment.startsWith(':') ? pathSegments[i] !== '' : segment === pathSegments[i],
  );
}
