import { ReactElement, useEffect, useRef, useState } from 'react';
import { BoardType, type Project } from '@xyne/shared';
import { Button as BlendButton, ButtonType, Modal } from '@juspay/blend-design-system';
import { ProjectCard } from '../../components/Project';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { usePlatform } from '../../hooks/usePlatform';
import ReleaseRepoConfigModal from './ReleaseRepoConfigModal';

const ReleaseManagerView = (): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [configuringProject, setConfiguringProject] = useState<Project | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
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

  const attachableProjects = (projects ?? [])
    .filter(p => !p.boards?.some(b => b.boardType === BoardType.RELEASE))
    .filter(p => {
      const q = pickerQuery.trim().toLowerCase();
      return !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
    });

  useEffect((): (() => void) | undefined => {
    if (isMobile || showCreateModal) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile, showCreateModal]);

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
            <BlendButton
              buttonType={ButtonType.PRIMARY}
              text='New release project'
              onClick={() => setShowCreateModal(true)}
              data-track-category='ReleaseManager'
              data-track-name='CreateReleaseProject'
            />
          </div>
          <p className='text-xs text-muted-foreground'>Projects with repositories</p>
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
            <ProjectCard
              key={project.id}
              project={project}
              initialDetailTab='release'
              onConfigureRelease={setConfiguringProject}
            />
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
                  No projects with repositories yet
                </h3>
                <p className='text-xs text-muted-foreground'>
                  Configure a repository inside a project to see it here
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {showCreateModal && (
        <Modal
          isOpen={true}
          onClose={() => {
            setShowCreateModal(false);
            setPickerQuery('');
          }}
          title='Add a release project'
          showCloseButton={true}
          closeOnBackdropClick={false}
        >
          <div data-testid='add-release-project-dialog' className='w-[420px] max-w-full'>
            <p className='mb-3 text-xs text-muted-foreground'>
              Pick an existing project to attach repositories to. It appears here once a repository
              is configured.
            </p>
            <input
              type='text'
              value={pickerQuery}
              onChange={e => setPickerQuery(e.target.value)}
              placeholder='Search projects...'
              className='mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              data-track-category='ReleaseManager'
              data-track-name='SearchAttachableProjects'
            />
            {attachableProjects.length === 0 ? (
              <p className='py-6 text-center text-sm text-muted-foreground'>
                No projects available — every project is already a release project.
              </p>
            ) : (
              <div className='max-h-[50vh] space-y-1.5 overflow-y-auto'>
                {attachableProjects.map(p => (
                  <button
                    key={p.id}
                    type='button'
                    onClick={() => {
                      setConfiguringProject(p);
                      setShowCreateModal(false);
                      setPickerQuery('');
                    }}
                    className='flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted'
                    data-track-category='ReleaseManager'
                    data-track-name='SelectProjectForRelease'
                  >
                    <span className='truncate text-sm font-semibold text-foreground'>{p.name}</span>
                    <span className='ml-2 shrink-0 rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground'>
                      {p.code}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {configuringProject && (
        <ReleaseRepoConfigModal
          project={configuringProject}
          isOpen={true}
          onClose={() => setConfiguringProject(null)}
        />
      )}
    </div>
  );
};

ReleaseManagerView.displayName = 'ReleaseManagerView';

export default ReleaseManagerView;
