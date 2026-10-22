/** Resolve dashboard-relative context links before the existing native link handlers. */
export function resolveThreadContextLink(url: string, origin: string, userScheme: string): string {
  const absolute = /^\/(?!\/)/.test(url) ? `${origin.replace(/\/$/, '')}${url}` : url;
  try {
    const parsed = new URL(absolute);
    if (parsed.origin !== origin.replace(/\/$/, '')) return absolute;
    const user = parsed.pathname.match(/^\/(?:[^/]+\/){0,2}chat\/dir\/user\/([^/]+)\/?$/);
    if (user?.[1]) return `${userScheme}${encodeURIComponent(decodeURIComponent(user[1]))}`;
  } catch {
    return url;
  }
  return absolute;
}
