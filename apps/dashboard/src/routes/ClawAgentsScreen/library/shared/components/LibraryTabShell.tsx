import { type ReactElement, type ReactNode } from 'react';
import { EmptyState } from '@/components/Board/EmptyState/EmptyState';
import { LibraryCardSkeleton } from './LibraryCard';

const SKELETON_COUNT = 6;

export interface LibraryEmptyState {
  icon: string;
  title: string;
  description: string;
}

export function LibraryGrid({ children }: { children: ReactNode }): ReactElement {
  return <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>{children}</div>;
}

export function LibrarySections({
  sections,
}: {
  sections: { key: string; label: string; items: ReactNode[] }[];
}): ReactElement {
  return (
    <div className='flex flex-col gap-8'>
      {sections.map(section => (
        <section key={section.key} className='flex flex-col gap-3'>
          <h2 className='text-xs font-semibold uppercase tracking-[0.48px] text-muted-foreground'>
            {section.label}
          </h2>
          <LibraryGrid>{section.items}</LibraryGrid>
        </section>
      ))}
    </div>
  );
}

export function LibraryTabShell({
  toolbar,
  isLoading,
  error,
  emptyState,
  children,
}: {
  toolbar: ReactNode;
  isLoading: boolean;
  error?: { message: string; onRetry: () => void } | undefined;
  emptyState?: LibraryEmptyState | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      {toolbar}
      {isLoading ? (
        <LibraryGrid>
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <LibraryCardSkeleton key={i} />
          ))}
        </LibraryGrid>
      ) : error ? (
        <div className='flex flex-col items-center gap-3 py-16 text-center'>
          <p className='text-sm text-muted-foreground'>{error.message}</p>
          <button
            type='button'
            onClick={error.onRetry}
            data-track-category='Claw Agents'
            data-track-name='Retry library load'
            className='text-sm font-medium text-[color:var(--mention-color)] underline underline-offset-2'
          >
            Retry
          </button>
        </div>
      ) : emptyState ? (
        <EmptyState
          icon={emptyState.icon}
          title={emptyState.title}
          description={emptyState.description}
        />
      ) : (
        children
      )}
    </>
  );
}
