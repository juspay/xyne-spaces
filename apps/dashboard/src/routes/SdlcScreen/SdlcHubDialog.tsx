import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, GitBranch, Link2, Lock, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import Input from '../../components/ui/Input';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';
import {
  SDLC_SEARCH_BADGE,
  SdlcRegisterRepositoryForm,
  looksLikeRepositoryLink,
  providerKeyOf,
  providerOptionsFor,
  sdlcErrorMessage,
  useSdlcProviders,
  useSdlcRepositorySearch,
  type SdlcRepositoryDraft,
} from './SdlcRegisterRepositoryForm';

interface RepositoryOption {
  id: string;
  name: string;
  url: string;
  canonicalUrl: string | null;
  visibility: string | null;
  accessJobStatus: string;
}

type RepositoryPick = SelectorOption & { projectId: string | null };

interface SdlcHubDialogProps {
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing hub. No rename endpoint, so this only changes repositories. */
  hub?: {
    channelId: string;
    repoIds: string[];
    repositories?: Array<{ id: string; name: string; url: string; projectId: string | null }>;
  };
  onSaved: (channelId: string) => void;
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
  const [search, setSearch] = useState('');
  const [providerKey, setProviderKey] = useState<string | null>(null);
  const [registering, setRegistering] = useState<SdlcRepositoryDraft | null>(null);
  const [pickedElsewhere, setPickedElsewhere] = useState<RepositoryPick[]>([]);

  useEffect(() => {
    if (!open) return;
    setName('');
    setRepoIds(hub?.repoIds ?? []);
    setPickedProjectId(projectId ?? null);
    setRegistering(null);
    setPickedElsewhere([]);
  }, [open, hub?.repoIds, projectId]);

  const [projectRows] = useCachedQuery(queries.getAllProjectsList(), { enabled: open });
  const projects = useMemo(
    () => (Array.isArray(projectRows) ? (projectRows as Array<{ id: string; name: string }>) : []),
    [projectRows],
  );
  // Seeded from the current hub's project, or the only one there is; still a picker, a
  // new hub need not live in the same project.
  const onlyProjectId = projects.length === 1 ? projects[0]!.id : null;
  const activeProjectId = pickedProjectId ?? onlyProjectId;
  const projectOptions = useMemo<SelectorOption[]>(
    () =>
      projects.map(project => ({
        value: project.id,
        label: project.name,
        icon: <FolderKanban className='size-4 text-muted-foreground' />,
      })),
    [projects],
  );

  const {
    data: repositories,
    isLoading: repositoriesLoading,
    refetch: refetchRepositories,
  } = useQuery({
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

  const { data: providers } = useSdlcProviders(open);
  const providerOptions = useMemo(() => providerOptionsFor(providers), [providers]);
  const activeProviderKey =
    providerKey ??
    providerOptions.find(option => !option.value.startsWith('GITHUB:'))?.value ??
    providerOptions[0]?.value ??
    null;
  const activeProvider = providers?.find(item => providerKeyOf(item) === activeProviderKey);
  const {
    data: searchResults,
    isFetching: searchFetching,
    active: searching,
  } = useSdlcRepositorySearch({
    enabled: open && !registering,
    projectId: activeProjectId,
    provider: activeProvider,
    query: search,
  });

  const options = useMemo(() => repositories ?? [], [repositories]);
  // subtitle is `owner/repo`, which the selector also searches on.
  const repositoryOptions = useMemo<SelectorOption[]>(
    () =>
      options.map(repository => ({
        value: repository.id,
        label: repository.name,
        subtitle: repository.canonicalUrl || repository.url,
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
  const selectedOptions = useMemo(() => {
    const known: RepositoryPick[] = [
      ...repositoryOptions.map(option => ({ ...option, projectId: activeProjectId })),
      ...pickedElsewhere,
      ...(hub?.repositories ?? []).map(repository => ({
        value: repository.id,
        label: repository.name,
        subtitle: repository.url,
        projectId: repository.projectId,
        icon: <GitBranch className='size-4 text-muted-foreground' />,
      })),
    ];
    return repoIds.flatMap(id => known.find(option => option.value === id) ?? []);
  }, [activeProjectId, hub?.repositories, pickedElsewhere, repoIds, repositoryOptions]);
  const projectNameOf = (id: string | null): string | undefined =>
    projects.find(project => project.id === id)?.name;

  const addRepository = (option: RepositoryPick): void => {
    if (!repositoryOptions.some(known => known.value === option.value)) {
      setPickedElsewhere(current => [
        ...current.filter(item => item.value !== option.value),
        option,
      ]);
    }
    setRepoIds(ids => (ids.includes(option.value) ? ids : [...ids, option.value]));
  };
  const addableOptions = useMemo<RepositoryPick[]>(() => {
    if (!searching) {
      return repositoryOptions
        .filter(
          option =>
            !repoIds.includes(option.value) &&
            (!activeProvider ||
              (option.subtitle ?? '').toLowerCase().includes(`${activeProvider.host}/`)),
        )
        .map(option => ({ ...option, projectId: activeProjectId }));
    }
    return (searchResults ?? []).flatMap((result, index) => {
      if (result.id && repoIds.includes(result.id)) return [];
      return [
        {
          value: result.status === 'NOT_LINKED' ? `new:${index}` : (result.id ?? `other:${index}`),
          label: result.name,
          subtitle: result.canonicalUrl,
          projectId: result.projectId,
          icon: <GitBranch className='size-4 text-muted-foreground' />,
          badge: SDLC_SEARCH_BADGE[result.status],
        },
      ];
    });
  }, [activeProjectId, activeProvider, repoIds, repositoryOptions, searchResults, searching]);

  const startRegistering = (draft: Omit<SdlcRepositoryDraft, 'projectId' | 'providerKey'>): void =>
    setRegistering({ ...draft, projectId: activeProjectId, providerKey: activeProviderKey });

  const onRegistered = async (repository: {
    id: string;
    projectId: string;
    name: string;
    canonicalUrl: string;
  }): Promise<void> => {
    setRegistering(null);
    await refetchRepositories();
    addRepository({
      value: repository.id,
      label: repository.name,
      subtitle: repository.canonicalUrl,
      projectId: repository.projectId,
      icon: <GitBranch className='size-4 text-muted-foreground' />,
    });
  };

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
      toast.error(sdlcErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const title = editing ? 'Hub repositories' : 'New hub';
  if (registering) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title='Register repository'>
        <SdlcRegisterRepositoryForm
          initial={registering}
          onCancel={() => setRegistering(null)}
          onRegistered={repository => void onRegistered(repository)}
        />
      </Dialog>
    );
  }
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
            ? 'Repositories this hub covers.'
            : 'A private workspace covering one or more repositories. It never appears in Chat.'}
        </p>

        <div className='mt-6 space-y-5'>
          {!editing && (
            <div>
              <p className='mb-2 text-sm font-medium'>
                Project <span className='text-destructive'>*</span>
              </p>
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
                Name <span className='text-destructive'>*</span>
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
            <p className='mb-2 text-sm font-medium'>Provider</p>
            <EntitySelector
              options={providerOptions}
              selectedValue={activeProviderKey}
              onSelect={value => setProviderKey(value)}
              placeholder={providers === undefined ? 'Loading providers…' : 'Select a provider'}
              searchPlaceholder='Search providers...'
              width='100%'
              matchTriggerWidth
            />
          </div>

          <div>
            <p className='mb-2 text-sm font-medium'>Repositories</p>
            {selectedOptions.length > 0 && (
              <ul className='mb-2 divide-y overflow-hidden rounded-lg border'>
                {selectedOptions.map(option => (
                  <li key={option.value} className='flex items-center gap-3 py-2 pl-3 pr-1.5'>
                    {option.icon}
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate text-sm font-medium'>{option.label}</span>
                      {option.subtitle && (
                        <span className='block truncate text-xs text-muted-foreground'>
                          {option.subtitle}
                        </span>
                      )}
                      {projectNameOf(option.projectId) && (
                        <span className='flex items-center gap-1 truncate text-xs text-muted-foreground'>
                          <FolderKanban className='size-3 shrink-0' />
                          {projectNameOf(option.projectId)}
                        </span>
                      )}
                    </span>
                    {option.badge && (
                      <span className='shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300'>
                        {option.badge}
                      </span>
                    )}
                    <Button
                      type='button'
                      variant='ghost'
                      size='iconSm'
                      aria-label={`Remove ${option.label}`}
                      onClick={() => setRepoIds(ids => ids.filter(id => id !== option.value))}
                      data-track-category='SdlcHub'
                      data-track-name='HubRepositoryRemoved'
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <EntitySelector
              options={addableOptions}
              selectedValue={null}
              onSelect={value => {
                if (!value) return;
                if (value.startsWith('new:')) {
                  const result = searchResults?.[Number(value.slice(4))];
                  if (result?.cloneUrl) {
                    startRegistering({
                      url: result.cloneUrl,
                      name: result.name,
                      credentials: result.credentials,
                    });
                  }
                  return;
                }
                const option = addableOptions.find(item => item.value === value);
                if (option) addRepository(option);
              }}
              onSearchChange={setSearch}
              disableClientFiltering={searching}
              {...(looksLikeRepositoryLink(search)
                ? {
                    headerAction: {
                      label: `Add from link: ${search.trim()}`,
                      icon: <Link2 className='size-4' />,
                      onClick: () =>
                        startRegistering({ url: search.trim(), name: '', credentials: [] }),
                      trackCategory: 'SdlcHub',
                      trackName: 'HubRepositoryAddedFromLink',
                    },
                  }
                : {})}
              isLoading={repositoriesLoading || searchFetching}
              placeholder={!activeProjectId ? 'Choose a project first' : 'Add a repository'}
              searchPlaceholder={
                activeProvider
                  ? `Search ${activeProvider.host} repositories, or paste a link`
                  : 'Search by name, or paste a repository link'
              }
              width='100%'
              matchTriggerWidth
            />
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
            disabled={!editing && (!name.trim() || !activeProjectId)}
            data-track-category='SdlcHub'
            data-track-name={editing ? 'HubRepositoriesSaved' : 'HubCreated'}
          >
            {!editing && <Plus />}
            {editing ? 'Save' : 'Create hub'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
