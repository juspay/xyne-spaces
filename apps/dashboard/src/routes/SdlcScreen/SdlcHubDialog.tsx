import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, GitBranch, Lock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { EntityMultiSelector } from '../../components/ui/EntitySelector/EntityMultiSelector';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import Input from '../../components/ui/Input';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';

interface RepositoryOption {
  id: string;
  name: string;
  url: string;
  canonicalUrl: string | null;
  visibility: string | null;
  accessJobStatus: string;
}

/** `owner/repo`, so two same-named repositories stay distinct. */
function repositorySlug(repository: RepositoryOption): string | null {
  const source = repository.canonicalUrl || repository.url;
  const match = /(?:[:/])([^/:]+\/[^/]+?)(?:\.git)?$/.exec(source.trim());
  return match?.[1] ?? null;
}

interface SdlcHubDialogProps {
  /** Omitted for the first hub of all; the dialog then asks for the project. */
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing hub. No rename endpoint, so this only changes repositories. */
  hub?: { channelId: string; repoIds: string[] };
  onSaved: (channelId: string) => void;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error?: unknown } } }).response;
    if (typeof response?.data?.error === 'string') return response.data.error;
  }
  return error instanceof Error ? error.message : 'Action failed';
}

/** Create a hub, or change the repositories an existing one covers. */
export function SdlcHubDialog({
  projectId,
  open,
  onOpenChange,
  hub,
  onSaved,
}: SdlcHubDialogProps): ReactElement {
  const editing = hub !== undefined;
  const [name, setName] = useState('');
  const [repoIds, setRepoIds] = useState<string[]>([]);
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Seeded from the current hub's project when there is one, but still a picker: a
  // new hub need not live in the same project.
  const activeProjectId = pickedProjectId;

  useEffect(() => {
    if (!open) return;
    setName('');
    setRepoIds(hub?.repoIds ?? []);
    setPickedProjectId(projectId ?? null);
  }, [open, hub?.repoIds, projectId]);

  const [projectRows] = useCachedQuery(queries.getAllProjectsList(), {
    enabled: open && !editing,
  });
  const projects = useMemo(
    () => (Array.isArray(projectRows) ? (projectRows as Array<{ id: string; name: string }>) : []),
    [projectRows],
  );
  const projectOptions = useMemo<SelectorOption[]>(
    () =>
      projects.map(project => ({
        value: project.id,
        label: project.name,
        icon: <FolderKanban className='size-4 text-muted-foreground' />,
      })),
    [projects],
  );

  const { data: repositories, isLoading: repositoriesLoading } = useQuery({
    queryKey: ['sdlc-project-repositories', activeProjectId],
    queryFn: async () => {
      const response = await apiInstance.get<{ repositories: RepositoryOption[] }>(
        `/sdlc/projects/${encodeURIComponent(activeProjectId!)}/repositories`,
      );
      return response.data.repositories;
    },
    enabled: open && Boolean(activeProjectId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const options = useMemo(() => repositories ?? [], [repositories]);
  // subtitle is `owner/repo`, which the selector also searches on.
  const repositoryOptions = useMemo<SelectorOption[]>(
    () =>
      options.map(repository => ({
        value: repository.id,
        label: repository.name,
        subtitle: repositorySlug(repository),
        icon:
          repository.visibility === 'PRIVATE' ? (
            <Lock className='size-4 text-muted-foreground' />
          ) : (
            <GitBranch className='size-4 text-muted-foreground' />
          ),
        ...(repository.accessJobStatus !== 'READY' ? { badge: 'Access pending' } : {}),
      })),
    [options],
  );
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      if (editing) {
        const added = repoIds.filter(id => !hub.repoIds.includes(id));
        const removed = hub.repoIds.filter(id => !repoIds.includes(id));
        if (added.length > 0) {
          await apiInstance.post(
            `/sdlc/channels/${encodeURIComponent(hub.channelId)}/repositories`,
            { repoIds: added },
          );
        }
        // Sequential: the server decides which one is the last, which it refuses.
        for (const repoId of removed) {
          await apiInstance.delete(
            `/sdlc/channels/${encodeURIComponent(hub.channelId)}/repositories/${encodeURIComponent(repoId)}`,
          );
        }
        toast.success('Hub repositories updated');
        onSaved(hub.channelId);
      } else {
        const response = await apiInstance.post<{ channel: { id: string } }>('/sdlc/channels', {
          projectId: activeProjectId,
          name: name.trim(),
          repoIds,
        });
        toast.success('Hub created');
        onSaved(response.data.channel.id);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const title = editing ? 'Hub repositories' : 'New hub';
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <form
        className='p-6'
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className='text-lg font-semibold tracking-tight'>{title}</h2>
        <p className='mt-1.5 text-sm leading-6 text-muted-foreground'>
          {editing
            ? 'Repositories this hub covers. A hub always keeps at least one.'
            : 'A private workspace covering one or more repositories. It never appears in Chat.'}
        </p>

        <div className='mt-6 space-y-5'>
          {!editing && (
            <div>
              <p className='mb-2 text-sm font-medium'>Project</p>
              <EntitySelector
                options={projectOptions}
                selectedValue={activeProjectId}
                onSelect={value => {
                  setPickedProjectId(value);
                  setRepoIds([]);
                }}
                placeholder={
                  projectRows === undefined
                    ? 'Loading projects…'
                    : projectOptions.length === 0
                      ? 'No projects available'
                      : 'Select a project'
                }
                searchPlaceholder='Search projects...'
                width='100%'
                matchTriggerWidth
              />
            </div>
          )}

          {!editing && (
            <div>
              <label htmlFor='sdlc-hub-name' className='block text-sm font-medium'>
                Name
              </label>
              <Input
                id='sdlc-hub-name'
                autoFocus
                value={name}
                onChange={event => setName(event.target.value)}
                className='mt-2 h-10'
                placeholder='e.g. Payments platform'
              />
            </div>
          )}

          <div>
            <p className='mb-2 text-sm font-medium'>Repositories</p>
            <EntityMultiSelector
              options={repositoryOptions}
              selectedValues={repoIds}
              onMultiSelect={setRepoIds}
              showSearch
              isLoading={repositoriesLoading}
              placeholder={
                !activeProjectId
                  ? 'Choose a project first'
                  : repositoryOptions.length === 0
                    ? 'This project has no repositories'
                    : 'Select repositories'
              }
              searchPlaceholder='Search repositories...'
              width='100%'
              matchTriggerWidth
              collapseSelectedAfter={2}
              collapsedLabel='repositories'
            />
            {repoIds.length === 0 && (
              <p className='mt-2 text-xs text-muted-foreground'>Pick at least one repository.</p>
            )}
          </div>
        </div>

        <div className='mt-7 flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            data-track-category='SdlcHub'
            data-track-name='HubDialogCancelled'
          >
            Cancel
          </Button>
          <Button
            type='submit'
            loading={busy}
            disabled={repoIds.length === 0 || (!editing && (!name.trim() || !activeProjectId))}
            data-track-category='SdlcHub'
            data-track-name={editing ? 'HubRepositoriesSaved' : 'HubCreated'}
          >
            <Plus />
            {editing ? 'Save' : 'Create hub'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
