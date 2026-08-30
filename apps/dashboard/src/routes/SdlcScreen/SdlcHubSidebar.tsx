import { useMemo, useState, type ReactElement } from 'react';
import { ChevronRight, ExternalLink, GitBranch, Hash, Lock, Settings2 } from 'lucide-react';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../components/ui/EntitySelector/EntitySelector.types';
import { Popover } from '../../components/ui/Popover';

export interface SdlcHubRepository {
  id: string;
  name: string;
  url: string;
  canonicalUrl?: string | null;
}

export interface SdlcHubOption {
  id: string;
  name: string;
  visibility: string;
  repositories: SdlcHubRepository[];
}

function repositoryHref(repository: SdlcHubRepository): string {
  return repository.canonicalUrl || repository.url;
}

/** Hub switcher. Repository names ride in the subtitle, which the selector searches. */
export function SdlcHubPicker(props: {
  hubs: SdlcHubOption[];
  selectedHubId: string;
  onSelect: (hubId: string) => void;
}): ReactElement {
  const options = useMemo<SelectorOption[]>(
    () =>
      props.hubs.map(hub => ({
        value: hub.id,
        label: hub.name,
        subtitle:
          hub.repositories.map(repository => repository.name).join(', ') || 'No repositories',
        // Channel semantics: a lock for private, a hash for public.
        icon:
          hub.visibility === 'PUBLIC' ? (
            <Hash className='size-4 text-muted-foreground' />
          ) : (
            <Lock className='size-4 text-muted-foreground' />
          ),
      })),
    [props.hubs],
  );

  return (
    <EntitySelector
      options={options}
      selectedValue={props.selectedHubId}
      onSelect={value => {
        if (value) props.onSelect(value);
      }}
      placeholder='Select hub'
      searchPlaceholder='Search hubs and repositories...'
      width='100%'
      matchTriggerWidth
    />
  );
}

/** The hub's repositories, each opening in a new tab. */
export function SdlcHubRepositories(props: {
  repositories: SdlcHubRepository[];
  onManage: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const count = props.repositories.length;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side='top'
      align='start'
      sideOffset={6}
      className='w-[260px] p-0'
      trigger={
        <button
          type='button'
          className='flex w-full items-center gap-2 rounded-lg px-2 py-2 font-medium transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent-ring'
          aria-label='Repositories in this hub'
          data-track-category='SdlcHub'
          data-track-name='HubRepositoryListOpened'
        >
          <GitBranch className='size-4 shrink-0 text-sidebar-foreground/65' />
          <span className='min-w-0 flex-1 truncate text-left'>Repositories</span>
          <span className='shrink-0 text-[11px] tabular-nums text-sidebar-foreground/55'>
            {count}
          </span>
          <ChevronRight className='size-3.5 shrink-0 text-sidebar-foreground/55' />
        </button>
      }
    >
      <div className='max-h-72 overflow-y-auto py-1'>
        {count === 0 ? (
          <p className='px-3 py-4 text-center text-xs text-muted-foreground'>
            No repositories in this hub.
          </p>
        ) : (
          props.repositories.map(repository => (
            <a
              key={repository.id}
              href={repositoryHref(repository)}
              target='_blank'
              rel='noreferrer'
              className='flex items-center gap-2 px-2.5 py-2 transition-colors hover:bg-muted/60'
              data-track-category='SdlcHub'
              data-track-name='HubRepositoryOpened'
            >
              <GitBranch className='size-3.5 shrink-0 text-muted-foreground' />
              <span className='min-w-0 flex-1 truncate text-[12.5px]'>{repository.name}</span>
              <ExternalLink className='size-3 shrink-0 text-muted-foreground' />
            </a>
          ))
        )}
      </div>
      <button
        type='button'
        className='flex w-full items-center gap-2 border-t px-2.5 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground'
        onClick={() => {
          setOpen(false);
          props.onManage();
        }}
        data-track-category='SdlcHub'
        data-track-name='HubRepositoriesOpened'
      >
        <Settings2 className='size-3.5' />
        Manage repositories
      </button>
    </Popover>
  );
}
