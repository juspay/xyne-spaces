import { ReactElement, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe, Search } from 'lucide-react';
import { Dialog } from '../ui/Dialog/Dialog';
import Input from '../ui/Input/Input';
import { AppIcon } from '../AppIcon/AppIcon';
import { ToggleGlyph } from './ToggleGlyph';
import { listArtifactApps, type ArtifactAppSummary } from '../../services/claw/artifactAppsService';
import { MAX_APPS_PER_BAR } from '../../hooks/barItems';
import { cn } from '../../utils/classNames';
import type { AppPublishOptions } from './useChannelAppPublishing';

interface AppPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Apps already in the bar; their rows read as checked. */
  addedAppIds: ReadonlySet<string>;
  /** The bar has no room for another app. */
  isFull: boolean;
  /** Published apps; showing one again doesn't need room in the bar. */
  publishedAppIds?: ReadonlySet<string>;
  /** `next` is the membership the row is being toggled to. */
  onToggle: (app: ArtifactAppSummary, next: boolean) => void;
  trackCategory: string;
  /** Only rows this accepts are listed, e.g. a desk takes workspace-published apps only. */
  appFilter?: (app: ArtifactAppSummary) => boolean;
  /** Replaces the default "saved or published" line under the title. */
  description?: string;
  /** Replaces the default "up to N apps per bar" footnote, for a non-bar host. */
  limitNote?: { normal: string; full: string };
  /**
   * Step 2 for channel admins: publish an app to every member's tabs. Absent for
   * everyone else, who see the picker exactly as before.
   */
  publish?: AppPublishOptions;
}

const DEFAULT_DESCRIPTION =
  'Apps you saved or that were published to this workspace. Pick as many as you need.';

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
  publishedAppIds,
  onToggle,
  trackCategory,
  appFilter,
  description = DEFAULT_DESCRIPTION,
  limitNote,
  publish,
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
      .filter(a => !appFilter || appFilter(a))
      .filter(
        a =>
          !q || `${a.title} ${a.description ?? ''} ${a.ownerName ?? ''}`.toLowerCase().includes(q),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [mine.data, workspace.data, query, appFilter]);

  const isLoading = mine.isLoading || workspace.isLoading;
  const isError = mine.isError || workspace.isError;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Add apps'
      description={description}
      className='max-w-md'
      mobileVariant='dialog'
    >
      {/* This Dialog renders `title`/`description` for screen readers only and
          adds no padding of its own, so the visible header and the gutter are
          the caller's job — same p-6 + h2 shape as every other dialog. */}
      <div className='p-6'>
        <div className='mb-4'>
          <h2 className='text-lg font-semibold text-foreground'>Add apps</h2>
          <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
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
                  const disabled = !added && isFull && !publishedAppIds?.has(app.id);
                  const published = publish?.publishedAppIds.has(app.id) ?? false;
                  return (
                    <li key={app.id} className='flex items-center'>
                      <button
                        type='button'
                        role='switch'
                        aria-checked={added}
                        disabled={disabled}
                        onClick={() => onToggle(app, !added)}
                        className={cn(
                          'flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition-colors',
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
                      {publish && (
                        <PublishButton app={app} published={published} publish={publish} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className='text-xs text-muted-foreground'>
            {isFull
              ? (limitNote?.full ??
                'This bar already holds the maximum number of apps. Switch one off to add another.')
              : (limitNote?.normal ?? `Up to ${MAX_APPS_PER_BAR} apps per bar.`)}
            {publish &&
              ` Publish puts an app in the tabs of everyone in this ${publish.audience}; each person can still remove it for themselves.`}
          </p>
        </div>
      </div>
    </Dialog>
  );
};

/** The per-row "Publish to channel" control shown to channel admins. */
const PublishButton = ({
  app,
  published,
  publish,
}: {
  app: ArtifactAppSummary;
  published: boolean;
  publish: AppPublishOptions;
}): ReactElement => {
  // Members see a published app only if they can open it, so a private app
  // would publish to nobody.
  const notShared = app.visibility !== 'WORKSPACE';
  const blocked = !published && (notShared || publish.isFull);
  const title = published
    ? `Unpublish: remove it from everyone’s tabs in this ${publish.audience}`
    : notShared
      ? 'Publish the app to the workspace first'
      : publish.isFull
        ? `This ${publish.audience} already has the maximum number of published apps`
        : `Add to the tabs of everyone in this ${publish.audience}`;
  return (
    <button
      type='button'
      disabled={blocked}
      onClick={() => publish.onToggle(app, !published)}
      title={title}
      aria-label={title}
      aria-pressed={published}
      className={cn(
        'mr-3 grid size-7 shrink-0 place-items-center rounded-md border transition-colors',
        published
          ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
        blocked && 'cursor-not-allowed opacity-50 hover:bg-transparent',
      )}
      data-track-category='CHANNELS'
      data-track-name={published ? 'UnpublishChannelApp' : 'PublishChannelApp'}
      data-track-metadata={JSON.stringify({ appId: app.id })}
    >
      <Globe className='size-3.5' aria-hidden='true' />
    </button>
  );
};
