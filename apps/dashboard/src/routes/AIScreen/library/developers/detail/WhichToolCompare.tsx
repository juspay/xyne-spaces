import { type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cn } from '@/utils/classNames';
import type { DeveloperToolId } from '../developerTools';

const OPTIONS: {
  id: 'sdk' | 'cli';
  title: string;
  where: string;
  points: string[];
}[] = [
  {
    id: 'cli',
    title: 'Spaces CLI',
    where: 'Your app runs inside Spaces',
    points: [
      'An artifact app in the toolbar, Inbox, a channel tab or Agent Hub',
      'Scaffolded from a ready React template, SDK already wired in',
      'No sign-in code: it runs as whoever opens it',
      'Published to your workspace with one command',
    ],
  },
  {
    id: 'sdk',
    title: 'Spaces SDK',
    where: 'Your app runs outside Spaces',
    points: [
      'Your own web app, backend, script or CLI',
      'Install from npm into any TypeScript or JavaScript project',
      'Users sign in with Xyne SSO; the code acts as them',
      'You host and run it yourself',
    ],
  },
];

/** "Which one do I need?" — shown on both the SDK and the CLI pages. */
export function WhichToolCompare({ current }: { current: DeveloperToolId }): ReactElement {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);

  return (
    <div className='grid w-full grid-cols-1 gap-3 sm:grid-cols-2'>
      {OPTIONS.map(option => {
        const isCurrent = option.id === current;
        const body = (
          <>
            <div className='flex flex-col gap-0.5'>
              <span className='text-sm font-semibold leading-5 text-foreground'>
                {option.title}
                {isCurrent && (
                  <span className='ml-2 text-xs font-normal text-muted-foreground'>this page</span>
                )}
              </span>
              <span className='text-xs font-medium leading-5 text-primary'>{option.where}</span>
            </div>
            <ul className='flex flex-col gap-1.5'>
              {option.points.map(point => (
                <li key={point} className='flex gap-2 text-xs leading-5 text-foreground/75'>
                  <span className='mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground' />
                  {point}
                </li>
              ))}
            </ul>
            {!isCurrent && (
              <span className='mt-auto text-xs font-medium text-primary'>
                Open {option.title} →
              </span>
            )}
          </>
        );
        const className = cn(
          'flex flex-col gap-3 rounded-2xl border p-4',
          isCurrent ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
        );
        return isCurrent ? (
          <div key={option.id} className={className}>
            {body}
          </div>
        ) : (
          <Link
            key={option.id}
            to={prefixWs(`/ai/library/developers/${option.id}`)}
            data-track-category='Developer tools'
            data-track-name={`Compare: open ${option.title}`}
            className={cn(className, 'transition-colors hover:border-primary/40')}
          >
            {body}
          </Link>
        );
      })}
    </div>
  );
}
