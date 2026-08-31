import { ReactElement, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { type Project, type VCSProviderType } from '@xyne/shared';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { Button } from '../../components/ui/Button';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import {
  ReleaseConfigWizard,
  type ReleaseConfigMode,
} from '../../components/Release/ReleaseConfigWizard';
import {
  RepoDot,
  ProviderBadge,
  repoColor,
  repoHostPath,
} from '../../components/Release/repoVisual';

interface ReleaseRepoConfigModalProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
}

const ReleaseRepoConfigModal = ({
  project,
  isOpen,
  onClose,
}: ReleaseRepoConfigModalProps): ReactElement => {
  const [boards] = useCachedQuery(queries.boardsListByProject({ projectId: project.id }));
  const [applications] = useCachedQuery(queries.applicationsByProjectId({ projectId: project.id }));
  const [flow, setFlow] = useState<ReleaseConfigMode | null>(null);

  const boardNamesById = useMemo(
    () => Object.fromEntries((boards ?? []).map(b => [b.id, b.name])),
    [boards],
  );
  const boardVcsProviderById = useMemo(
    () =>
      Object.fromEntries((boards ?? []).map(b => [b.id, b.vcsProvider ?? null])) as Record<
        string,
        VCSProviderType | null
      >,
    [boards],
  );

  const repositories = useMemo(() => {
    const list = !applications || applications instanceof Error ? [] : applications;
    const counts = new Map<string, number>();
    const repoUrlByBoard = new Map<string, string>();
    for (const app of list) {
      const id = app.mainReleaseBoardId;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (app.repoUrl && !repoUrlByBoard.has(id)) repoUrlByBoard.set(id, app.repoUrl);
    }
    return [...counts.entries()].map(([mainBoardId, appCount]) => ({
      mainBoardId,
      name: boardNamesById[mainBoardId] ?? mainBoardId,
      appCount,
      repoUrl: repoUrlByBoard.get(mainBoardId) ?? null,
      vcsProvider: boardVcsProviderById[mainBoardId] ?? null,
    }));
  }, [applications, boardNamesById, boardVcsProviderById]);

  const appsForWizard = applications instanceof Error ? undefined : applications;

  return (
    <>
      <Dialog
        open={isOpen && !flow}
        onOpenChange={open => {
          if (!open) onClose();
        }}
        title={`Configure repositories · ${project.name}`}
        className='max-w-[640px] overflow-hidden p-0'
      >
        {/* Header */}
        <div className='flex items-start justify-between gap-3 border-b border-border px-6 py-4'>
          <div>
            <h2 className='text-[17px] font-bold leading-tight text-foreground'>
              Configure repositories · {project.name}
            </h2>
            <p className='mt-1 text-[12.5px] text-muted-foreground'>
              Repositories shipped together in this release. Each row opens its configuration.
            </p>
          </div>
          <button
            type='button'
            onClick={onClose}
            aria-label='Close'
            className='shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground'
            data-track-category='ReleaseRepoConfig'
            data-track-name='CloseModal'
          >
            <X className='size-[18px]' />
          </button>
        </div>

        {/* Body */}
        <div className='max-h-[60vh] space-y-2.5 overflow-y-auto px-6 py-4'>
          <p className='font-mono text-[10px] uppercase tracking-wide text-muted-foreground'>
            Repositories
          </p>
          {repositories.length === 0 && (
            <p className='rounded-lg border border-dashed border-border bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground'>
              No repositories configured yet.
            </p>
          )}
          {repositories.map(repo => (
            <div
              key={repo.mainBoardId}
              className='flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3.5'
            >
              <RepoDot color={repoColor(repo.mainBoardId)} className='mt-[5px]' />
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-semibold text-foreground'>{repo.name}</div>
                {repo.repoUrl && (
                  <div className='truncate font-mono text-[11.5px] text-muted-foreground'>
                    {repoHostPath(repo.repoUrl)}
                  </div>
                )}
              </div>
              <div className='flex shrink-0 items-center gap-2.5 self-center'>
                <ProviderBadge vcsProvider={repo.vcsProvider} />
                <span className='rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground'>
                  {repo.appCount} service{repo.appCount === 1 ? '' : 's'}
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setFlow({ kind: 'edit-main', mainBoardId: repo.mainBoardId })}
                >
                  Edit
                </Button>
              </div>
            </div>
          ))}
          <button
            type='button'
            onClick={() => setFlow({ kind: 'create' })}
            className='flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5'
            data-track-category='ReleaseRepoConfig'
            data-track-name='AddRepository'
          >
            <Plus className='size-4' /> Add repository
          </button>
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-3.5'>
          <span className='text-[12px] text-muted-foreground'>
            {repositories.length} repositor{repositories.length === 1 ? 'y' : 'ies'}
          </span>
          <div className='flex gap-2'>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Dialog>

      {flow && (
        <ReleaseConfigWizard
          projectId={project.id}
          boardNamesById={boardNamesById}
          applications={appsForWizard}
          mode={flow}
          isOpen={true}
          onClose={() => setFlow(null)}
          onSave={() => setFlow(null)}
        />
      )}
    </>
  );
};

export default ReleaseRepoConfigModal;
