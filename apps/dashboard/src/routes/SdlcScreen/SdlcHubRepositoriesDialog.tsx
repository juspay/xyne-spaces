import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { GitBranch, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { EntityMultiSelector } from '../../components/ui/EntitySelector/EntityMultiSelector';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import { apiInstance } from '../../services/clients/apiClient';
import {
  SDLC_SEARCH_BADGE,
  SdlcRegisterRepositoryForm,
  providerKeyOf,
  providerOptionsFor,
  sdlcErrorMessage,
  useSdlcProviders,
  useSdlcRepositorySearch,
  type SdlcRepositorySearchResult,
} from './SdlcRegisterRepositoryForm';

const keyOf = (result: SdlcRepositorySearchResult): string => result.id ?? result.canonicalUrl;

/** A hub's repositories: disconnect any of them, or add several from one provider. */
export function SdlcHubRepositoriesDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  projectId: string;
  /** Live from Zero, so the list follows each add and disconnect once it syncs. */
  repositories: Array<{ id: string; name: string; url: string }>;
}): ReactElement {
  const { open, onOpenChange, channelId, projectId, repositories } = props;
  const [adding, setAdding] = useState(false);
  const [registeringLink, setRegisteringLink] = useState(false);
  const [providerKey, setProviderKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<SdlcRepositorySearchResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAdding(false);
    setRegisteringLink(false);
    setSearch('');
    setPicked([]);
  }, [open]);

  const { data: providers } = useSdlcProviders(open);
  const providerOptions = useMemo(() => providerOptionsFor(providers), [providers]);
  const activeProviderKey =
    providerKey ??
    providerOptions.find(option => !option.value.startsWith('GITHUB:'))?.value ??
    providerOptions[0]?.value ??
    null;
  const activeProvider = providers?.find(item => providerKeyOf(item) === activeProviderKey);
  const { data: searchResults, isFetching: searchFetching } = useSdlcRepositorySearch({
    enabled: open && adding && !registeringLink,
    projectId,
    provider: activeProvider,
    query: search,
  });

  // Picks stay in the options so their chips survive a new search.
  const { options, resultByKey } = useMemo(() => {
    const attached = new Set(repositories.map(repository => repository.id));
    const byKey = new Map<string, SdlcRepositorySearchResult>();
    for (const result of [...picked, ...(searchResults ?? [])]) {
      if (!(result.id && attached.has(result.id))) byKey.set(keyOf(result), result);
    }
    return {
      resultByKey: byKey,
      options: [...byKey.values()].map<SelectorOption>(result => ({
        value: keyOf(result),
        label: result.name,
        // The multi-selector draws no badges, so what Add will do rides on the subtitle.
        subtitle:
          result.status === 'LINKED'
            ? result.canonicalUrl
            : `${SDLC_SEARCH_BADGE[result.status]} · ${result.canonicalUrl}`,
        icon: <GitBranch className='size-4 text-muted-foreground' />,
      })),
    };
  }, [picked, repositories, searchResults]);

  const channelPath = `/sdlc/channels/${encodeURIComponent(channelId)}/repositories`;
  const disconnect = async (repoId: string): Promise<void> => {
    try {
      await apiInstance.delete(`${channelPath}/${encodeURIComponent(repoId)}`);
    } catch (error) {
      toast.error(sdlcErrorMessage(error));
    }
  };
  const addPicked = async (): Promise<void> => {
    setBusy(true);
    try {
      // Not yet registered: register with the provider's defaults (name, default branch).
      const settled = await Promise.allSettled(
        picked.map(async result => {
          if (result.id) return result;
          const response = await apiInstance.post<{ repository: { id: string } }>(
            '/sdlc/repositories',
            {
              projectId,
              url: result.cloneUrl ?? result.canonicalUrl,
              name: result.name,
              ...(result.credentials[0] ? { credentialId: result.credentials[0].id } : {}),
            },
          );
          return { ...result, id: response.data.repository.id, status: 'LINKED' as const };
        }),
      );
      // Keep the ids of the ones that did register, so a retry does not register them again (409).
      const registered = settled.map((outcome, index) =>
        outcome.status === 'fulfilled' ? outcome.value : picked[index]!,
      );
      const failure = settled.find(outcome => outcome.status === 'rejected');
      if (failure) {
        setPicked(registered);
        throw failure.reason;
      }
      await apiInstance.post(channelPath, { repoIds: registered.map(result => result.id!) });
      setPicked([]);
      setAdding(false);
    } catch (error) {
      toast.error(sdlcErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (registeringLink) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title='Register repository'>
        <SdlcRegisterRepositoryForm
          initial={{
            projectId,
            providerKey: activeProviderKey,
            url: '',
            name: '',
            credentials: [],
          }}
          onCancel={() => setRegisteringLink(false)}
          onRegistered={repository => {
            setRegisteringLink(false);
            setAdding(false);
            void apiInstance
              .post(channelPath, { repoIds: [repository.id] })
              .catch((error: unknown) => toast.error(sdlcErrorMessage(error)));
          }}
        />
      </Dialog>
    );
  }

  if (adding) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title='Add repositories'>
        <div className='p-6'>
          <h2 className='text-lg font-semibold tracking-tight'>Add repositories</h2>
          <p className='mt-1.5 text-sm leading-6 text-muted-foreground'>
            Choose a provider, then pick one or more repositories.
          </p>

          <div className='mt-6 space-y-5'>
            <div>
              <p className='mb-2 text-sm font-medium'>Provider</p>
              <EntitySelector
                options={providerOptions}
                selectedValue={activeProviderKey}
                onSelect={value => {
                  setProviderKey(value);
                  setPicked([]);
                }}
                placeholder={providers === undefined ? 'Loading providers…' : 'Select a provider'}
                searchPlaceholder='Search providers...'
                width='100%'
                matchTriggerWidth
              />
            </div>

            <div>
              <p className='mb-2 text-sm font-medium'>Repositories</p>
              <div className='flex flex-wrap items-center gap-1.5'>
                <EntityMultiSelector
                  options={options}
                  selectedValues={picked.map(keyOf)}
                  onMultiSelect={values =>
                    setPicked(values.flatMap(value => resultByKey.get(value) ?? []))
                  }
                  onSearchChange={setSearch}
                  // It clears its own search box on close without reporting it.
                  onOpenChange={isOpen => {
                    if (!isOpen) setSearch('');
                  }}
                  disableClientFiltering
                  isLoading={searchFetching}
                  showSearch
                  placeholder='Select repositories'
                  searchPlaceholder={
                    activeProvider ? `Search ${activeProvider.host} repositories` : 'Search'
                  }
                  width='100%'
                  inputClassName='h-10'
                  matchTriggerWidth
                />
              </div>
              <button
                type='button'
                onClick={() => setRegisteringLink(true)}
                className='mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline'
                data-track-category='SdlcHub'
                data-track-name='HubRepositoryRegisterByLink'
              >
                Not listed? Register by link
              </button>
            </div>
          </div>

          <div className='mt-7 flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setAdding(false);
                setPicked([]);
              }}
              data-track-category='SdlcHub'
              data-track-name='HubRepositoriesAddCancelled'
            >
              Back
            </Button>
            <Button
              type='button'
              loading={busy}
              disabled={picked.length === 0}
              onClick={() => void addPicked()}
              data-track-category='SdlcHub'
              data-track-name='HubRepositoriesAdded'
            >
              <Plus />
              {picked.length > 0 ? `Add ${picked.length}` : 'Add'}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title='Hub repositories'>
      <div className='p-6'>
        <h2 className='text-lg font-semibold tracking-tight'>Hub repositories</h2>
        <p className='mt-1.5 text-sm leading-6 text-muted-foreground'>
          Repositories this hub covers.
        </p>

        <ul className='mt-6 max-h-72 divide-y overflow-y-auto rounded-lg border'>
          {repositories.map(repository => (
            <li key={repository.id} className='flex items-center gap-3 py-2 pl-3 pr-2'>
              <GitBranch className='size-4 shrink-0 text-muted-foreground' />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium'>{repository.name}</span>
                <span className='block truncate text-xs text-muted-foreground'>
                  {repository.url}
                </span>
              </span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                trackAction={() => disconnect(repository.id)}
                data-track-category='SdlcHub'
                data-track-name='HubRepositoryDisconnected'
              >
                Disconnect
              </Button>
            </li>
          ))}
          {repositories.length === 0 && (
            <li className='px-3 py-3 text-sm text-muted-foreground'>No repositories yet.</li>
          )}
        </ul>

        <div className='mt-7 flex justify-between gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={() => setAdding(true)}
            data-track-category='SdlcHub'
            data-track-name='HubRepositoriesAddOpened'
          >
            <Plus />
            Add repositories
          </Button>
          <Button
            type='button'
            onClick={() => onOpenChange(false)}
            data-track-category='SdlcHub'
            data-track-name='HubRepositoriesDone'
          >
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
