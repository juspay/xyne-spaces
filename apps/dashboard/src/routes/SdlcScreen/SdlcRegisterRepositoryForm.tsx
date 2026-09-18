import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { FolderKanban, GitBranch, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import Input from '../../components/ui/Input';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';

export type SdlcCredentialChoice = { id: string; name: string; accountName: string | null };

export interface SdlcProviderHost {
  provider: 'GITHUB' | 'BITBUCKET_SERVER';
  host: string;
}

export interface SdlcRepositorySearchResult {
  status: 'LINKED' | 'NOT_LINKED' | 'OTHER_PROJECT';
  id: string | null;
  projectId: string | null;
  name: string;
  canonicalUrl: string;
  cloneUrl: string | null;
  credentials: SdlcCredentialChoice[];
}

export const SDLC_SEARCH_BADGE: Record<SdlcRepositorySearchResult['status'], string> = {
  LINKED: 'Linked',
  NOT_LINKED: 'Not linked',
  OTHER_PROJECT: 'Other project',
};

export interface SdlcRepositoryDraft {
  projectId: string | null;
  providerKey: string | null;
  url: string;
  name: string;
  credentials: SdlcCredentialChoice[];
}

export const providerKeyOf = (item: SdlcProviderHost): string => `${item.provider}:${item.host}`;

export function looksLikeRepositoryLink(value: string): boolean {
  return /:\/\/|@|\//.test(value.trim());
}

export function sdlcErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error?: unknown } } }).response;
    if (typeof response?.data?.error === 'string') return response.data.error;
  }
  return error instanceof Error ? error.message : 'Action failed';
}

export function useSdlcProviders(enabled: boolean): UseQueryResult<SdlcProviderHost[]> {
  return useQuery({
    queryKey: ['sdlc-vcs-providers'],
    queryFn: async () =>
      (await apiInstance.get<{ providers: SdlcProviderHost[] }>('/sdlc/vcs/providers')).data
        .providers,
    enabled,
  });
}

export function useSdlcRepositorySearch(input: {
  enabled: boolean;
  projectId: string | null;
  provider: SdlcProviderHost | undefined;
  query: string;
}): UseQueryResult<SdlcRepositorySearchResult[]> & { active: boolean } {
  const debounced = useDebouncedValue(input.query.trim(), 300);
  const active =
    input.enabled &&
    Boolean(input.projectId && input.provider) &&
    !looksLikeRepositoryLink(debounced) &&
    debounced.length !== 1;
  const result = useQuery({
    queryKey: [
      'sdlc-repository-search',
      input.projectId,
      input.provider && providerKeyOf(input.provider),
      debounced,
    ],
    queryFn: async () =>
      (
        await apiInstance.get<{ repositories: SdlcRepositorySearchResult[] }>(
          `/sdlc/projects/${encodeURIComponent(input.projectId!)}/repositories/search`,
          {
            params: {
              q: debounced,
              provider: input.provider!.provider,
              host: input.provider!.host,
            },
          },
        )
      ).data.repositories,
    enabled: active,
  });
  return { ...result, active };
}

export function providerOptionsFor(providers: SdlcProviderHost[] | undefined): SelectorOption[] {
  return (providers ?? []).map(item => ({
    value: providerKeyOf(item),
    label: item.provider === 'GITHUB' ? 'GitHub' : 'Bitbucket',
    subtitle: item.host,
    icon: <GitBranch className='size-4 text-muted-foreground' />,
  }));
}

export function SdlcRegisterRepositoryForm(props: {
  initial: SdlcRepositoryDraft;
  cancelLabel?: string;
  onCancel: () => void;
  onRegistered: (repository: {
    id: string;
    projectId: string;
    name: string;
    canonicalUrl: string;
  }) => void;
}): ReactElement {
  const [projectId, setProjectId] = useState(props.initial.projectId);
  const [providerKey, setProviderKey] = useState(props.initial.providerKey);
  const [url, setUrl] = useState(props.initial.url);
  const [name, setName] = useState(props.initial.name);
  // A ref, so typing a name does not re-resolve the link.
  const nameEdited = useRef(false);
  const [baseBranch, setBaseBranch] = useState('main');
  const branchEdited = useRef(false);
  const [credentials, setCredentials] = useState(props.initial.credentials);
  const [credentialId, setCredentialId] = useState<string | null>(
    props.initial.credentials.length === 1 ? props.initial.credentials[0]!.id : null,
  );
  const [existing, setExisting] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const [projectRows] = useCachedQuery(queries.getAllProjectsList(), { enabled: true });
  const projectOptions = useMemo<SelectorOption[]>(
    () =>
      (Array.isArray(projectRows) ? (projectRows as Array<{ id: string; name: string }>) : []).map(
        project => ({
          value: project.id,
          label: project.name,
          icon: <FolderKanban className='size-4 text-muted-foreground' />,
        }),
      ),
    [projectRows],
  );
  const { data: providers } = useSdlcProviders(true);
  const providerOptions = useMemo(() => providerOptionsFor(providers), [providers]);
  const activeProviderKey =
    providerKey ??
    providerOptions.find(option => !option.value.startsWith('GITHUB:'))?.value ??
    providerOptions[0]?.value ??
    null;
  const provider = providers?.find(item => providerKeyOf(item) === activeProviderKey);
  const {
    data: results,
    isFetching,
    active,
  } = useSdlcRepositorySearch({
    enabled: true,
    projectId,
    provider,
    query: search,
  });

  const choose = (next: {
    url: string;
    name: string;
    credentials: SdlcCredentialChoice[];
  }): void => {
    setUrl(next.url);
    if (!nameEdited.current) setName(next.name);
    setCredentials(next.credentials);
    setCredentialId(next.credentials.length === 1 ? next.credentials[0]!.id : null);
  };

  useEffect(() => {
    if (!url || !projectId) return;
    let cancelled = false;
    apiInstance
      .post<{
        link: {
          name: string;
          defaultBranch: string;
          existingRepository: { name: string; projectId: string | null } | null;
          credentials: SdlcCredentialChoice[];
        };
      }>('/sdlc/repositories/resolve-link', { projectId, url })
      .then((response): void => {
        if (cancelled) return;
        const link = response.data.link;
        setExisting(link.existingRepository ? link.existingRepository.name : null);
        if (!nameEdited.current) setName(current => current || link.name);
        if (!branchEdited.current) setBaseBranch(link.defaultBranch);
        setCredentials(link.credentials);
        setCredentialId(current =>
          link.credentials.some(item => item.id === current)
            ? current
            : link.credentials.length === 1
              ? link.credentials[0]!.id
              : null,
        );
      })
      .catch((error: unknown): void => {
        if (!cancelled) toast.error(sdlcErrorMessage(error));
      });
    return (): void => {
      cancelled = true;
    };
  }, [url, projectId]);

  const repositoryOptions = useMemo<SelectorOption[]>(
    () =>
      active
        ? (results ?? []).map((result, index) => ({
            value: String(index),
            label: result.name,
            subtitle: result.canonicalUrl,
            icon: <GitBranch className='size-4 text-muted-foreground' />,
            badge: SDLC_SEARCH_BADGE[result.status],
            disabled: result.status !== 'NOT_LINKED',
          }))
        : [],
    [active, results],
  );

  const submit = async (): Promise<void> => {
    if (!projectId) return;
    setBusy(true);
    try {
      const response = await apiInstance.post<{
        repository: { id: string; name: string; canonicalUrl: string };
      }>('/sdlc/repositories', {
        projectId,
        url,
        name: name.trim(),
        baseBranch: baseBranch.trim() || 'main',
        ...(credentialId ? { credentialId } : {}),
      });
      toast.success(`${response.data.repository.name} registered`);
      props.onRegistered({ ...response.data.repository, projectId });
    } catch (error) {
      toast.error(sdlcErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className='p-6'
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className='text-lg font-semibold tracking-tight'>Register repository</h2>
      <p className='mt-1.5 text-sm leading-6 text-muted-foreground'>
        Registers the repository in a project, then runs a non-mutating access check.
      </p>

      <div className='mt-6 space-y-5'>
        <div>
          <p className='mb-2 text-sm font-medium'>Project</p>
          <EntitySelector
            options={projectOptions}
            selectedValue={projectId}
            onSelect={setProjectId}
            placeholder='Select a project'
            searchPlaceholder='Search projects...'
            width='100%'
            matchTriggerWidth
          />
        </div>

        <div>
          <p className='mb-2 text-sm font-medium'>Provider</p>
          <EntitySelector
            options={providerOptions}
            selectedValue={activeProviderKey}
            onSelect={setProviderKey}
            placeholder={providers === undefined ? 'Loading providers…' : 'Select a provider'}
            searchPlaceholder='Search providers...'
            width='100%'
            matchTriggerWidth
          />
        </div>

        <div>
          <p className='mb-2 text-sm font-medium'>Repository</p>
          <EntitySelector
            options={repositoryOptions}
            selectedValue={null}
            onSelect={value => {
              const result = value === null ? undefined : results?.[Number(value)];
              if (result?.cloneUrl) {
                choose({
                  url: result.cloneUrl,
                  name: result.name,
                  credentials: result.credentials,
                });
              }
            }}
            onSearchChange={setSearch}
            disableClientFiltering
            {...(looksLikeRepositoryLink(search)
              ? {
                  headerAction: {
                    label: `Use link: ${search.trim()}`,
                    icon: <Link2 className='size-4' />,
                    onClick: () => choose({ url: search.trim(), name: '', credentials: [] }),
                    trackCategory: 'SdlcHub',
                    trackName: 'RegisterRepositoryLinkUsed',
                  },
                }
              : {})}
            isLoading={isFetching}
            placeholder={url || 'Search repositories, or paste a link'}
            searchPlaceholder={
              provider ? `Search ${provider.host} repositories, or paste a link` : 'Paste a link'
            }
            width='100%'
            matchTriggerWidth
          />
          {existing && (
            <p className='mt-2 text-xs text-destructive'>
              Already registered as {existing}. Add it from the hub&apos;s repository list instead.
            </p>
          )}
        </div>

        <div>
          <label htmlFor='sdlc-register-name' className='block text-sm font-medium'>
            Repository name
          </label>
          <Input
            id='sdlc-register-name'
            value={name}
            onChange={event => {
              nameEdited.current = true;
              setName(event.target.value);
            }}
            className='mt-2 h-10'
          />
        </div>

        <div>
          <label htmlFor='sdlc-register-branch' className='block text-sm font-medium'>
            Base branch
          </label>
          <Input
            id='sdlc-register-branch'
            value={baseBranch}
            onChange={event => {
              branchEdited.current = true;
              setBaseBranch(event.target.value);
            }}
            className='mt-2 h-10'
          />
        </div>

        {credentials.length > 1 && (
          <div>
            <p className='mb-2 text-sm font-medium'>Credential</p>
            <div className='flex flex-wrap gap-2'>
              {credentials.map(credential => (
                <Button
                  key={credential.id}
                  type='button'
                  size='sm'
                  variant={credentialId === credential.id ? 'default' : 'outline'}
                  onClick={() => setCredentialId(credential.id)}
                >
                  {credential.name}
                  {credential.accountName ? ` (${credential.accountName})` : ''}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className='mt-7 flex justify-end gap-2'>
        <Button type='button' variant='outline' onClick={props.onCancel}>
          {props.cancelLabel ?? 'Back'}
        </Button>
        <Button
          type='submit'
          loading={busy}
          disabled={
            !projectId ||
            !url ||
            !name.trim() ||
            Boolean(existing) ||
            (credentials.length > 1 && !credentialId)
          }
          data-track-category='SdlcHub'
          data-track-name='RepositoryRegistered'
        >
          Register
        </Button>
      </div>
    </form>
  );
}
