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
