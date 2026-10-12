import { ReactElement } from 'react';
import { VCSProviderType } from '@xyne/shared';

const REPO_PALETTE = ['#E0503F', '#2B5FC0', '#1B855C', '#A3651F', '#7A6BA8', '#3F7A75'];

export const repoColor = (key: string | null | undefined): string => {
  const s = key ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return REPO_PALETTE[h % REPO_PALETTE.length] ?? '#E0503F';
};

const repoWebBase = (repoUrl: string): string => repoUrl.replace(/\/$/, '').replace(/\.git$/, '');

export const repoShortName = (repoUrl: string | null | undefined): string => {
  if (!repoUrl) return 'Repository';
  const base = repoWebBase(repoUrl);
  return base.split('/').filter(Boolean).pop() ?? base;
};

export const repoHostPath = (repoUrl: string | null | undefined): string =>
  repoUrl ? repoWebBase(repoUrl).replace(/^https?:\/\//, '') : '';

// A release config's repository as the web page that file and commit links hang off:
// https://<host>/<owner>/<repo> on GitHub, https://<host>[/<context>]/projects/<KEY>/repos/<slug>
// on Bitbucket Server. Repositories are registered by clone, SSH or browse URL, with or
// without a scheme, and none of those but the browse URL is a web page on Bitbucket.
export const repoWebUrl = (
  repo: { readonly url: string; readonly canonicalUrl?: string | null } | null | undefined,
): string | null => {
  if (!repo) return null;
  const raw = (repo.canonicalUrl || repo.url).trim();
  const scpLike = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(raw);
  const candidate = scpLike
    ? `ssh://git@${scpLike[1]}/${scpLike[2]}`
    : /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? raw
      : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);
  const withoutGit = (name: string): string => name.replace(/\.git$/i, '');

  if (
    host === 'github.com' ||
    host === 'www.github.com' ||
    (host.startsWith('github.') && !host.startsWith('github.com.'))
  ) {
    const [owner, name] = segments;
    return owner && name ? `https://${host}/${owner}/${withoutGit(name)}` : null;
  }

  // Bitbucket Server: browse (/projects/KEY/repos/slug, /users/name/repos/slug), HTTP
  // clone (/scm/key/slug.git) or SSH (/key/slug.git), possibly under a context path.
  const bitbucketPage = (prefix: string[], key: string, slug: string): string => {
    const base = [`https://${host}`, ...prefix].join('/');
    return key.startsWith('~')
      ? `${base}/users/${key.slice(1)}/repos/${withoutGit(slug)}`
      : `${base}/projects/${key.toUpperCase()}/repos/${withoutGit(slug)}`;
  };
  const browse = segments.findIndex(
    (segment, i) => (segment === 'projects' || segment === 'users') && segments[i + 2] === 'repos',
  );
  if (browse >= 0 && segments[browse + 1] && segments[browse + 3]) {
    const key = segments[browse] === 'users' ? `~${segments[browse + 1]}` : segments[browse + 1]!;
    return bitbucketPage(segments.slice(0, browse), key, segments[browse + 3]!);
  }
  const scm = segments.indexOf('scm');
  if (scm >= 0 && segments[scm + 1] && segments[scm + 2]) {
    return bitbucketPage(segments.slice(0, scm), segments[scm + 1]!, segments[scm + 2]!);
  }
  const key = segments[segments.length - 2];
  const slug = segments[segments.length - 1];
  return key && slug ? bitbucketPage([], key, slug) : null;
};

export const RepoDot = ({
  color,
  className = '',
}: {
  color: string;
  className?: string;
}): ReactElement => (
  <span
    className={`inline-block size-2.5 shrink-0 rounded-full ${className}`}
    style={{ backgroundColor: color }}
  />
);

export const ProviderBadge = ({
  vcsProvider,
  showLabel = true,
}: {
  vcsProvider: VCSProviderType | null | undefined;
  showLabel?: boolean;
}): ReactElement => {
  const bb =
    vcsProvider === VCSProviderType.BITBUCKET_SERVER ||
    vcsProvider === VCSProviderType.BITBUCKET_CLOUD;
  return (
    <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'>
      {bb ? (
        <span
          className='inline-block size-3.5 rounded-[3px]'
          style={{ backgroundColor: '#2172E5' }}
        />
      ) : (
        <span className='inline-block size-3.5 rounded-full bg-foreground' />
      )}
      {showLabel && (bb ? 'Bitbucket' : 'GitHub')}
    </span>
  );
};
