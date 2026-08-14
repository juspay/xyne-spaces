import { ReactElement, useEffect, useRef, useState } from 'react';
import { BoardType } from '@xyne/shared';
import { ProjectCard } from '../../components/Project';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { usePlatform } from '../../hooks/usePlatform';

const ReleaseManagerView = (): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const { isMobile } = usePlatform();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [projects] = useCachedQuery(queries.getAllProjects());
  const loading = projects === undefined;

  // A project is release-relevant iff it owns at least one release board.
  // `.related('boards')` on the query gives us the boards inline; no extra fetch.
  const releaseProjects = (projects ?? []).filter(p =>
    p.boards?.some(b => b.boardType === BoardType.RELEASE),
  );

  const filteredProjects = searchQuery.trim()
    ? releaseProjects.filter(p => {
        const q = searchQuery.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
      })
    : releaseProjects;

  useEffect((): (() => void) | undefined => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile]);

  if (loading) {
    return (
      <div className='h-full bg-background flex items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  return (
    <div
      data-testid='release-manager-page'
      className='h-full bg-background flex flex-col md:rounded-2xl overflow-hidden shadow-md'
    >
      <div className='flex-1 overflow-y-auto p-4'>
        <div className='mb-6'>
          <div className='flex items-center justify-between mb-2'>
            <h2 className='text-lg font-bold text-foreground'>Release Manager</h2>
          </div>
          <p className='text-xs text-muted-foreground'>Projects with release boards</p>
          <div className='mt-3'>
            <input
              ref={searchInputRef}
              type='text'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder='Search by name or project code...'
              className='w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              data-track-category='ReleaseManager'
              data-track-name='SearchReleaseProjects'
            />
          </div>
        </div>

        <div className='space-y-3' data-testid='release-project-list'>
          {filteredProjects.map(project => (
            <ProjectCard key={project.id} project={project} initialDetailTab='release' />
          ))}
        </div>

        {filteredProjects.length === 0 && (
          <div className='text-center py-8'>
            <div className='text-muted-foreground text-3xl mb-3'>🚀</div>
            {searchQuery.trim() ? (
              <>
                <h3 className='text-sm font-semibold text-foreground mb-1'>
                  No release projects found
                </h3>
                <p className='text-xs text-muted-foreground'>
                  No results for &quot;{searchQuery}&quot;
                </p>
              </>
            ) : (
              <>
                <h3 className='text-sm font-semibold text-foreground mb-1'>
                  No projects with release boards yet
                </h3>
                <p className='text-xs text-muted-foreground'>
                  Configure a release board inside a project to see it here
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

ReleaseManagerView.displayName = 'ReleaseManagerView';

export default ReleaseManagerView;
