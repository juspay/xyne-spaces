import type { ReactElement } from 'react';
import { BookMarked } from 'lucide-react';
import { Github } from '@xyne/icons';
import { repoUrlKey } from './repoUrlKey';

function BitbucketLogo({ className }: { className?: string }): ReactElement {
  return (
    <svg viewBox='0 0 24 24' className={className} aria-hidden fill='currentColor'>
      <path d='M2.65 3a.65.65 0 0 0-.65.75l2.73 16.56c.07.42.43.72.85.73h13.03c.32 0 .59-.23.64-.54L22 3.75A.65.65 0 0 0 21.35 3zm11.44 11.97H9.93l-1.12-5.88h6.28z' />
    </svg>
  );
}

export function ProviderIcon({ url }: { url: string }): ReactElement {
  const host = repoUrlKey(url).split('/')[0] ?? '';
  if (host.includes('github')) return <Github className='size-5' />;
  if (host.includes('bitbucket')) return <BitbucketLogo className='size-5 text-[#2684FF]' />;
  return <BookMarked className='size-5' />;
}
