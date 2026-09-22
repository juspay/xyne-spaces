import { ReactElement, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Dialog } from '../ui/Dialog/Dialog';
import Input from '../ui/Input/Input';
import { AppIcon } from '../AppIcon/AppIcon';
import { listArtifactApps, type ArtifactAppSummary } from '../../services/claw/artifactAppsService';
import { cn } from '../../utils/classNames';

interface AppPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Apps already in the bar; shown but not selectable. */
  addedAppIds: ReadonlySet<string>;
  /** The bar has no room for another app. */
  isFull: boolean;
  onPick: (app: ArtifactAppSummary) => void;
  trackCategory: string;
}

/**
 * Chooses an artifact app to add to a bar. Same two fetches as the Apps tab —
 * "mine" and "workspace" — under the same query keys, so the cache is shared
 * and this opens instantly when the library was visited first.
 */
export const AppPickerDialog = ({
  open,
  onOpenChange,
  addedAppIds,
  isFull,
  onPick,
  trackCategory,
}: AppPickerDialogProps): ReactElement => {
  const [query, setQuery] = useState('');

  const mine = useQuery({
    queryKey: ['artifact-apps', 'mine'],
    queryFn: () => listArtifactApps('mine'),
    enabled: open,
  });
  const workspace = useQuery({
    queryKey: ['artifact-apps', 'workspace'],
    queryFn: () => listArtifactApps('workspace'),
    enabled: open,
  });

  const apps = useMemo((): ArtifactAppSummary[] => {
    // "workspace" can include my own published apps; keep each app once.
    const byId = new Map<string, ArtifactAppSummary>();
    for (const app of [...(mine.data?.apps ?? []), ...(workspace.data?.apps ?? [])]) {
      if (!byId.has(app.id)) byId.set(app.id, app);
    }
    const q = query.trim().toLowerCase();
    return Array.from(byId.values())
      .filter(
        a =>
          !q || `${a.title} ${a.description ?? ''} ${a.ownerName ?? ''}`.toLowerCase().includes(q),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [mine.data, workspace.data, query]);

  const isLoading = mine.isLoading || workspace.isLoading;
  const isError = mine.isError || workspace.isError;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Add an app'
      description='Apps you saved or that were published to this workspace.'
      className='max-w-md'
      mobileVariant='dialog'
    >
      <div className='flex flex-col gap-3'>
        <div className='relative'>
          <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder='Search apps'
            className='pl-8'
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            data-track-category={trackCategory}
            data-track-name='SearchApps'
          />
        </div>

        <div className='max-h-80 overflow-y-auto rounded-lg border border-border'>
          {isLoading ? (
            <p className='p-4 text-sm text-muted-foreground'>Loading apps…</p>
          ) : isError ? (
            <p className='p-4 text-sm text-destructive'>Couldn&apos;t load apps.</p>
          ) : apps.length === 0 ? (
            <p className='p-4 text-sm text-muted-foreground'>
              {query ? 'No matching apps.' : 'No apps yet — save one from an AI chat first.'}
            </p>
          ) : (
            <ul className='divide-y divide-border'>
              {apps.map(app => {
                const added = addedAppIds.has(app.id);
                const disabled = added || isFull;
                return (
                  <li key={app.id}>
                    <button
                      type='button'
                      disabled={disabled}
                      onClick={() => {
                        onPick(app);
                        onOpenChange(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                        disabled
                          ? 'cursor-not-allowed opacity-50'
                          : 'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                      )}
                      data-track-category={trackCategory}
                      data-track-name='PickApp'
                      data-track-metadata={JSON.stringify({ appId: app.id })}
                    >
                      <span className='flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground'>
                        <AppIcon name={app.icon} size={16} aria-hidden='true' />
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate text-sm font-medium text-foreground'>
                          {app.title}
                        </span>
                        {app.ownerName && (
                          <span className='block truncate text-xs text-muted-foreground'>
                            {app.ownerName}
                          </span>
                        )}
                      </span>
                      {added && (
                        <span className='shrink-0 text-xs text-muted-foreground'>Added</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {isFull && (
          <p className='text-xs text-muted-foreground'>
            This bar already holds the maximum number of apps. Remove one to add another.
          </p>
        )}
      </div>
    </Dialog>
  );
};
