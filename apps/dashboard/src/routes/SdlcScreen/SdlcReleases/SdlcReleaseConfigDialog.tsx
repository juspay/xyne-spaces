import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronLeft, GitBranch, Hash, X } from 'lucide-react';
import { useChannelsByProjectId } from '@xyne/shared/hooks';
import type { ReleaseTrackingMode } from '@xyne/shared';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { EntitySelector } from '../../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../../components/ui/EntitySelector/EntitySelector.types';
import { RadioGroupItem, RadioGroupRoot } from '../../../components/ui/RadioGroup';
import { Tooltip } from '../../../components/ui/Tooltip';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { cn } from '../../../utils/classNames';
import type {
  ReleaseRepoDraft,
  RepoConfigState,
  SdlcReleaseConfigDialogProps,
  SdlcReleaseRepo,
} from './SdlcReleases.types';
import {
  EMPTY_REPO_DRAFT,
  REPO_CONFIG_STATE,
  TRACKING_MODES,
  TRACK_CATEGORY,
  missingForSave,
  plural,
  trackingModeTitle,
} from './SdlcReleases.utils';
import { useSaveReleaseRepoConfig } from './useSdlcReleases';
import { SearchInput, StatusPill } from './SdlcReleasePrimitives';
import { SdlcReleaseServices } from './SdlcReleaseServices';

const SECTION_LABEL_CLASS =
  'text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground';

export function SdlcReleaseConfigDialog({
  open,
  repos,
  onClose,
  onConnectRepository,
}: SdlcReleaseConfigDialogProps): ReactElement {
  const [repoId, setRepoId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReleaseRepoDraft>>({});
  const { saving, save } = useSaveReleaseRepoConfig();

  useEffect(() => {
    if (open) return;
    setRepoId(null);
    setDrafts({});
  }, [open]);

  const repo = repos.find(item => item.id === repoId);
  const draftOf = (target: SdlcReleaseRepo): ReleaseRepoDraft =>
    drafts[target.id] ?? target.config ?? EMPTY_REPO_DRAFT;
  const discardDraft = (id: string): void => setDrafts(({ [id]: _discarded, ...rest }) => rest);

  const handleSave = async (): Promise<void> => {
    if (!repo) return;
    const wasFirst = !repos.some(item => item.config);
    if (!(await save(repo, draftOf(repo)))) return;
    discardDraft(repo.id);
    if (wasFirst) onClose();
    else setRepoId(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => !next && onClose()}
      title='Release configuration'
      mobileVariant='dialog'
      className='flex h-[min(680px,calc(100vh-48px))] max-w-[820px] flex-col overflow-hidden rounded-2xl bg-background leading-tight'
    >
      {repo ? (
        <RepoForm
          key={repo.id}
          repo={repo}
          draft={draftOf(repo)}
          dirty={!!drafts[repo.id]}
          saving={saving}
          onChange={patch =>
            setDrafts(current => ({
              ...current,
              [repo.id]: { ...(current[repo.id] ?? repo.config ?? EMPTY_REPO_DRAFT), ...patch },
            }))
          }
          onBack={() => setRepoId(null)}
          onCancel={() => {
            discardDraft(repo.id);
            setRepoId(null);
          }}
          onClose={onClose}
          onSave={() => void handleSave()}
        />
      ) : (
        <RepoList
          repos={repos}
          drafts={drafts}
          onOpenRepo={setRepoId}
          onClose={onClose}
          onConnectRepository={onConnectRepository}
        />
      )}
    </Dialog>
  );
}

function RepoList({
  repos,
  drafts,
  onOpenRepo,
  onClose,
  onConnectRepository,
}: {
  repos: SdlcReleaseRepo[];
  drafts: Record<string, ReleaseRepoDraft>;
  onOpenRepo: (repoId: string) => void;
  onClose: () => void;
  onConnectRepository: () => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = repos.filter(repo => repo.name.toLowerCase().includes(needle));
  const configuredCount = repos.filter(repo => repo.config).length;

  return (
    <>
      <DialogHeader onClose={onClose}>
        <div className='flex flex-1 flex-col gap-1'>
          <h2 className='text-lg font-bold tracking-[-0.01em] text-foreground'>
            Release configuration
          </h2>
          <p className='text-[13.5px] leading-normal text-muted-foreground'>
            Release tracking is set up per repository. Pick one to configure its channel, tracking
            mode and services.
          </p>
        </div>
      </DialogHeader>
      <div className='flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 pb-6 pt-5'>
        <div className='flex items-center justify-between'>
          <span className={SECTION_LABEL_CLASS}>Repositories</span>
          <span className='text-[12.5px] text-muted-foreground'>
            {configuredCount} of {repos.length} configured
          </span>
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder='Search repositories'
          trackName='ConfigRepoSearched'
        />
        <div className='flex flex-col divide-y divide-border/70 overflow-hidden rounded-xl border border-border'>
          {shown.map(repo => (
            <RepoRow
              key={repo.id}
              repo={repo}
              state={drafts[repo.id] ? 'unsaved' : repo.config ? 'configured' : 'notSetUp'}
              onOpen={() => onOpenRepo(repo.id)}
            />
          ))}
          {shown.length === 0 && (
            <div className='px-4 py-4 text-center text-[13px] text-muted-foreground'>
              No repositories match &quot;{query}&quot;
            </div>
          )}
        </div>
        <span className='text-[12.5px] text-muted-foreground'>
          Missing one?{' '}
          <Button
            variant='link'
            onClick={onConnectRepository}
            className='h-auto p-0 text-[12.5px] font-medium'
            data-track-category={TRACK_CATEGORY}
            data-track-name='ConnectRepositoryFromReleaseConfig'
          >
            Connect it to the hub
          </Button>
        </span>
      </div>
      <DialogFooter>
        <span className='flex-1' />
        <Button
          variant='outline'
          onClick={onClose}
          data-track-category={TRACK_CATEGORY}
          data-track-name='ConfigDone'
        >
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

function RepoRow({
  repo,
  state,
  onOpen,
}: {
  repo: SdlcReleaseRepo;
  state: RepoConfigState;
  onOpen: () => void;
}): ReactElement {
  const channels = useChannelsByProjectId(repo.projectId ?? undefined);
  const config = repo.config;
  const channelName = config?.channelId
    ? channels.find(channel => channel.id === config.channelId)?.name
    : undefined;
  const summary = config
    ? [
        channelName && `#${channelName}`,
        trackingModeTitle(config.mode),
        plural(config.services.length, 'service'),
      ].filter(Boolean)
    : [];

  return (
    <button
      type='button'
      onClick={onOpen}
      className='flex w-full items-center gap-3.5 bg-background px-4 py-3.5 text-left transition-colors hover:bg-muted/40'
      data-track-category={TRACK_CATEGORY}
      data-track-name='ConfigRepoOpened'
    >
      <RepoIcon />
      <span className='flex min-w-0 flex-1 flex-col gap-1'>
        <span className='flex flex-wrap items-center gap-2'>
          <span className='text-[14.5px] font-semibold text-foreground'>{repo.name}</span>
          <StatusPill {...REPO_CONFIG_STATE[state]} />
        </span>
        <RepoMeta repo={repo} extra={summary.join(' · ')} />
      </span>
      <span
        className={cn(
          'flex h-8 items-center rounded-md px-3.5 text-[13px] font-semibold',
          config ? 'border border-border text-foreground/80' : 'bg-primary text-primary-foreground',
        )}
      >
        {config ? 'Edit' : 'Set up'}
      </span>
    </button>
  );
}

function RepoForm({
  repo,
  draft,
  dirty,
  saving,
  onChange,
  onBack,
  onCancel,
  onClose,
  onSave,
}: {
  repo: SdlcReleaseRepo;
  draft: ReleaseRepoDraft;
  dirty: boolean;
  saving: boolean;
  onChange: (patch: Partial<ReleaseRepoDraft>) => void;
  onBack: () => void;
  onCancel: () => void;
  onClose: () => void;
  onSave: () => void;
}): ReactElement {
  const configured = !!repo.config;
  const missing = missingForSave(draft);
  const canSave = missing.length === 0 && (dirty || !configured) && !saving;
  const hint =
    missing.length > 0
      ? `Add ${missing.join(', ')} to save`
      : dirty
        ? 'Unsaved changes'
        : configured
          ? 'Up to date'
          : 'Ready to save';

  return (
    <>
      <DialogHeader onClose={onClose}>
        <Tooltip content='All repositories'>
          <Button
            variant='ghost'
            size='iconSm'
            aria-label='All repositories'
            onClick={onBack}
            className='-mr-1 self-center'
            data-track-category={TRACK_CATEGORY}
            data-track-name='ConfigBackToRepos'
          >
            <ChevronLeft />
          </Button>
        </Tooltip>
        <RepoIcon />
        <div className='flex min-w-0 flex-1 flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='text-[17px] font-bold tracking-[-0.01em] text-foreground'>
              {repo.name}
            </h2>
            <StatusPill {...REPO_CONFIG_STATE[configured ? 'configured' : 'notSetUp']} />
          </div>
          <RepoMeta repo={repo} />
        </div>
      </DialogHeader>

      <div className='flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-7 pt-5'>
        <div className='flex flex-col gap-2.5'>
          <span className={SECTION_LABEL_CLASS}>Notifications &amp; tracking</span>
          <div className='flex flex-col divide-y divide-border/70 rounded-xl border border-border'>
            <SettingRow title='Release channel' description='Release updates post here.'>
              <ChannelPicker
                projectId={repo.projectId}
                channelId={draft.channelId}
                onChange={channelId => onChange({ channelId })}
              />
            </SettingRow>
            <SettingRow title='Tracking mode' description='What a release ticket asks for.'>
              <TrackingModePicker value={draft.mode} onChange={mode => onChange({ mode })} />
            </SettingRow>
          </div>
        </div>
        <SdlcReleaseServices
          repoName={repo.name}
          repoUrl={repo.repoUrl}
          projectId={repo.projectId}
          services={draft.services}
          onChange={services => onChange({ services })}
        />
      </div>

      <DialogFooter>
        <span
          className={cn(
            'flex flex-1 items-center gap-1.5 text-[12.5px]',
            dirty && missing.length === 0 ? 'text-status-pending' : 'text-muted-foreground',
          )}
        >
          <span className='size-1.5 rounded-full bg-current opacity-60' />
          {hint}
        </span>
        <Button
          variant='outline'
          onClick={onCancel}
          data-track-category={TRACK_CATEGORY}
          data-track-name='ConfigRepoCancelled'
        >
          Cancel
        </Button>
        <Button
          onClick={onSave}
          disabled={!canSave}
          data-track-category={TRACK_CATEGORY}
          data-track-name='ConfigRepoSaved'
        >
          {saving ? 'Saving…' : configured ? 'Save changes' : 'Save configuration'}
        </Button>
      </DialogFooter>
    </>
  );
}

function ChannelPicker({
  projectId,
  channelId,
  onChange,
}: {
  projectId: string | null;
  channelId: string | null;
  onChange: (channelId: string) => void;
}): ReactElement {
  const channels = useChannelsByProjectId(projectId ?? undefined);
  const channelIds = useMemo(() => channels.map(channel => channel.id), [channels]);
  const [stats] = useCachedQuery(queries.channelStatsByIds({ channelIds }), {
    enabled: channelIds.length > 0,
  });
  const options = useMemo(
    (): SelectorOption[] =>
      [...channels]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(channel => {
          const members = stats?.find(item => item.channelId === channel.id)?.participantCount;
          return {
            value: channel.id,
            label: channel.name,
            icon: <Hash size={14} className='text-muted-foreground' />,
            subtitle: members === undefined ? null : plural(members, 'member'),
          };
        }),
    [channels, stats],
  );

  return (
    <EntitySelector
      options={options}
      selectedValue={channelId}
      onSelect={next => next && onChange(next)}
      placeholder='Select a release channel'
      searchPlaceholder='Search channels…'
      allowDeselect={false}
      width='100%'
      matchTriggerWidth
      analytics={{
        category: TRACK_CATEGORY,
        searchName: 'ReleaseChannelSearched',
        optionName: 'ReleaseChannelPicked',
      }}
    />
  );
}

function TrackingModePicker({
  value,
  onChange,
}: {
  value: ReleaseTrackingMode;
  onChange: (mode: ReleaseTrackingMode) => void;
}): ReactElement {
  return (
    <RadioGroupRoot
      value={value}
      onValueChange={mode => onChange(mode as ReleaseTrackingMode)}
      className='grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2'
    >
      {TRACKING_MODES.map(mode => {
        const active = mode.id === value;
        const id = `release-tracking-mode-${mode.id}`;
        return (
          <label
            key={mode.id}
            htmlFor={id}
            className={cn(
              'flex cursor-pointer gap-2.5 rounded-[10px] border-[1.5px] px-3 py-2.5 transition-colors',
              active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
            )}
          >
            <RadioGroupItem
              id={id}
              value={mode.id}
              className='mt-px border-foreground/25 shadow-none'
              data-track-category={TRACK_CATEGORY}
              data-track-name='TrackingModePicked'
              data-track-label={mode.id}
            />
            <span className='flex min-w-0 flex-col gap-1.5'>
              <span className='text-[13.5px] font-semibold text-foreground'>{mode.title}</span>
              <span className='flex flex-wrap gap-1'>
                {mode.fields.map(field => (
                  <span
                    key={field}
                    className={cn(
                      'rounded px-1.5 py-0.5 font-code text-[11px] text-foreground/70',
                      active ? 'bg-primary/10' : 'bg-muted',
                    )}
                  >
                    {field}
                  </span>
                ))}
              </span>
            </span>
          </label>
        );
      })}
    </RadioGroupRoot>
  );
}

function DialogHeader({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <header className='flex items-start gap-3.5 border-b border-border/70 px-5 py-4'>
      {children}
      <Button
        variant='ghost'
        size='iconSm'
        aria-label='Close'
        onClick={onClose}
        className='text-muted-foreground'
        data-track-category={TRACK_CATEGORY}
        data-track-name='ConfigClosed'
      >
        <X />
      </Button>
    </header>
  );
}

function DialogFooter({ children }: { children: ReactNode }): ReactElement {
  return (
    <footer className='flex items-center gap-2.5 border-t border-border/70 bg-muted/30 px-6 py-3'>
      {children}
    </footer>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className='grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-6 gap-y-2 px-4 py-4'>
      <div className='flex flex-col gap-1 pt-0.5'>
        <span className='text-[13.5px] font-semibold text-foreground'>{title}</span>
        <span className='text-[12.5px] leading-snug text-muted-foreground'>{description}</span>
      </div>
      {children}
    </div>
  );
}

function RepoIcon(): ReactElement {
  return (
    <span className='flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-muted text-foreground/80'>
      <GitBranch size={17} />
    </span>
  );
}

function RepoMeta({ repo, extra }: { repo: SdlcReleaseRepo; extra?: string }): ReactElement {
  return (
    <span className='flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-muted-foreground'>
      {repo.host} ·
      <span className='rounded bg-muted px-1.5 py-px font-code text-[11.5px] text-foreground/70'>
        {repo.branch}
      </span>
      {extra && <span className='truncate'>· {extra}</span>}
    </span>
  );
}
