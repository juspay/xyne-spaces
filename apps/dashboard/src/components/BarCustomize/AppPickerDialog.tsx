import { ReactElement, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Dialog } from '../ui/Dialog/Dialog';
import Input from '../ui/Input/Input';
import { AppIcon } from '../AppIcon/AppIcon';
import { ToggleGlyph } from './ToggleGlyph';
import { listArtifactApps, type ArtifactAppSummary } from '../../services/claw/artifactAppsService';
import { MAX_APPS_PER_BAR } from '../../hooks/barItems';
import { cn } from '../../utils/classNames';

interface AppPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Apps already in the bar; their rows read as checked. */
  addedAppIds: ReadonlySet<string>;
  /** The bar has no room for another app. */
  isFull: boolean;
  /** `next` is the membership the row is being toggled to. */
  onToggle: (app: ArtifactAppSummary, next: boolean) => void;
  trackCategory: string;
}

/**
 * Chooses artifact apps for a bar. Rows toggle, and the dialog stays open until
 * it is dismissed, so several apps can be added (or one added by mistake taken
 * straight back off) in a single visit.
 *
 * Same two fetches as the Apps tab — "mine" and "workspace" — under the same
 * query keys, so the cache is shared and this opens instantly when the library
 * was visited first.
 */
export const AppPickerDialog = ({
  open,
  onOpenChange,
  addedAppIds,
  isFull,
  onToggle,
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
      title='Add apps'
      description='Apps you saved or that were published to this workspace. Pick as many as you need.'
      className='max-w-md'
      mobileVariant='dialog'
    >
      {/* This Dialog renders `title`/`description` for screen readers only and
          adds no padding of its own, so the visible header and the gutter are
          the caller's job — same p-6 + h2 shape as every other dialog. */}
      <div className='p-6'>
        <div className='mb-4'>
          <h2 className='text-lg font-semibold text-foreground'>Add apps</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Apps you saved or that were published to this workspace. Pick as many as you need.
          </p>
        </div>
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
                  // A full bar blocks adding, never un-adding — otherwise the
                  // only way back under the cap would be the bar itself.
                  const disabled = !added && isFull;
                  return (
                    <li key={app.id}>
                      <button
                        type='button'
                        role='switch'
                        aria-checked={added}
                        disabled={disabled}
                        onClick={() => onToggle(app, !added)}
                        className={cn(
                          'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                          disabled
                            ? 'cursor-not-allowed opacity-50'
                            : 'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                        )}
                        data-track-category={trackCategory}
                        data-track-name={added ? 'UnpickApp' : 'PickApp'}
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
                        <ToggleGlyph checked={added} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className='text-xs text-muted-foreground'>
            {isFull
              ? 'This bar already holds the maximum number of apps. Switch one off to add another.'
              : `Up to ${MAX_APPS_PER_BAR} apps per bar.`}
          </p>
        </div>
      </div>
    </Dialog>
  );
};
