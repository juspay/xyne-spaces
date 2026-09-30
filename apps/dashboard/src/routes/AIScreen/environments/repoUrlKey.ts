const SCP_STYLE_SSH = /^(?:[^@\s/]+@)?([^:\s/]+):(.+)$/;

/**
 * Match key for linking a Repository to Sandbox Profiles: SSH and HTTPS agree, and
 * Bitbucket's `ssh.` host and `/scm/` path aliases are dropped. Matching only, never stored.
 */
export function repoUrlKey(url: string): string {
  const raw = url.trim();
  const scp = raw.includes('://') ? null : raw.match(SCP_STYLE_SSH);
  let host: string;
  let path: string;
  if (scp) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    try {
      const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return raw.toLowerCase();
    }
  }
  const cleanPath = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .replace(/^scm\//i, '');
  return `${host.replace(/^ssh\./i, '')}/${cleanPath}`.toLowerCase();
}
