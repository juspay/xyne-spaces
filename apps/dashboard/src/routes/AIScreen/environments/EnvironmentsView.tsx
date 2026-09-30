import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BookMarked,
  Check,
  ChevronRight,
  Copy,
  GitBranch,
  HelpCircle,
  Plus,
  Search,
  Server,
  X,
} from 'lucide-react';
import { Github } from '@xyne/icons';
import type { SdlcEnvironmentRow } from '@xyne/shared';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Panel, ResizableGroup, Separator } from '@/components/ui/Resizable/Resizable';
import { Tabs } from '@/components/ui/Tabs';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { apiInstance } from '@/services/clients/apiClient';
import { clawApiRequest } from '@/services/claw/clawRequest';
import { useAuth } from '@/hooks/useAuth';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { useClawAdminAccessQuery } from '@/hooks/useClawAdminAccess';
import { queries } from '@/zero/queries';
import { cn } from '@/utils/classNames';
import {
  useSandboxRepos,
  type SandboxRepoOption,
} from '../library/agents/detail/behaviour/sandboxConfig';
import { repoUrlKey } from './repoUrlKey';
import { channelIcon } from '../library/shared/components/channelIcon';
import { LibraryFilterMenu } from '../library/shared/components/LibraryFilterMenu';

/** The subset of claw's RepoSetupConfig this page renders; the Raw config tab shows the rest. */
interface ProfileConfig {
  key: string;
  repoUrl?: string;
  defaultBranch?: string;
  cloneDepth?: number;
  workDir?: string;
  template?: string;
  sessionTimeoutMs?: number;
  idleTimeoutMs?: number;
  steps?: Array<{
    type: string;
    label?: string;
    name?: string;
    cmd?: string;
    cwd?: string;
    packages?: string[];
  }>;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\.git$/, '');
}

function webUrl(url: string): string {
  return url.includes('://') ? url : `https://${url}`;
}

function duration(ms: number | undefined): string | null {
  if (!ms) return null;
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

function stepTitle(step: NonNullable<ProfileConfig['steps']>[number]): string {
  switch (step.type) {
    case 'install':
      return 'Install packages';
    case 'services':
      return 'Start services';
    case 'devserver':
      return `Launch ${step.name ?? 'dev server'}`;
    default:
      return step.label ?? step.type;
  }
}

function Field({
  label,
  info,
  children,
}: {
  label: string;
  info?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className='grid grid-cols-[120px_minmax(0,1fr)] gap-4 py-1.5 text-sm'>
      <span className='flex items-center gap-1 text-muted-foreground'>
        {label}
        {info && (
          <Tooltip side='right' content={info} className='max-w-xs p-3'>
            <HelpCircle className='size-3.5 shrink-0' aria-label={`About ${label}`} />
          </Tooltip>
        )}
      </span>
      <span className='min-w-0 break-words'>{children}</span>
    </div>
  );
}

/** Text clamped to 3 lines, with Show more only when it actually overflows. */
function ClampText({
  text,
  className,
  trackName,
}: {
  text: string;
  className?: string;
  trackName: string;
}): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = (): void =>
      setOverflows(el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return (): void => observer.disconnect();
  }, [text, expanded]);
  return (
    <span className='block min-w-0'>
      <span
        ref={ref}
        className={cn(
          className,
          // line-clamp needs its own display (-webkit-box), so `block` only when unclamped.
          expanded ? 'block' : 'line-clamp-3',
        )}
      >
        {text}
      </span>
      {(overflows || expanded) && (
        <button
          type='button'
          onClick={() => setExpanded(value => !value)}
          className='mt-0.5 text-xs font-medium text-primary hover:underline'
          data-track-category='Environments'
          data-track-name={trackName}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  );
}

function Mono({ children }: { children: ReactNode }): ReactElement {
  return <code className='font-mono text-[13px]'>{children}</code>;
}

function Overview({ config }: { config: ProfileConfig }): ReactElement {
  const session = duration(config.sessionTimeoutMs);
  const idle = duration(config.idleTimeoutMs);
  return (
    <div className='flex flex-col gap-6'>
      <section>
        <h4 className='mb-1.5 text-sm font-semibold'>Source</h4>
        <Field label='Repository'>
          <Mono>{config.repoUrl ?? 'No repository (sandbox only)'}</Mono>
        </Field>
        {config.defaultBranch && (
          <Field label='Branch'>
            <Mono>{config.defaultBranch}</Mono>
            {config.cloneDepth ? (
              <span className='text-muted-foreground'> · clone depth {config.cloneDepth}</span>
            ) : null}
          </Field>
        )}
        {config.workDir && (
          <Field label='Work dir'>
            <Mono>{config.workDir}</Mono>
          </Field>
        )}
        {config.template && (
          <Field label='Template'>
            <Mono>{config.template}</Mono>
          </Field>
        )}
        {(session || idle) && (
          <Field
            label='Lifetime'
            info={
              <div className='flex flex-col gap-1.5 text-xs leading-5'>
                <p>
                  <strong>Session</strong>: the sandbox is destroyed this long after it starts.
                </p>
                <p>
                  <strong>Idle</strong>: destroyed sooner if no command runs for this long.
                </p>
                <p className='opacity-70'>
                  Used by sandbox-repo-setup. sandbox-create ignores these and defaults to 1h
                  session, 10 min idle.
                </p>
              </div>
            }
          >
            {[session && `${session} session`, idle && `${idle} idle`].filter(Boolean).join(' · ')}
          </Field>
        )}
      </section>
      {config.steps && config.steps.length > 0 && (
        <section>
          <h4 className='mb-3 text-sm font-semibold'>Boot sequence</h4>
          <ol className='flex flex-col gap-3'>
            {config.steps.map((step, index) => (
              <li key={index} className='flex gap-3'>
                <span className='flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary'>
                  {index + 1}
                </span>
                <div className='min-w-0 flex-1 pt-0.5'>
                  <div className='flex items-baseline justify-between gap-3'>
                    <span className='text-sm font-medium'>{stepTitle(step)}</span>
                    {step.cwd && (
                      <code className='shrink-0 font-mono text-xs text-muted-foreground'>
                        {step.cwd}
                      </code>
                    )}
                  </div>
                  {(step.packages?.length || step.cmd) && (
                    <pre className='mt-2 whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-5'>
                      {step.packages?.join(' ') ?? step.cmd}
                    </pre>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function RawConfig({ config }: { config: ProfileConfig }): ReactElement {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(config, null, 2);
  return (
    <div className='relative'>
      <Button
        variant='ghost'
        size='sm'
        className='absolute right-3 top-3 text-zinc-300 hover:bg-white/10 hover:text-white'
        onClick={() => {
          void navigator.clipboard.writeText(json);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <pre className='whitespace-pre-wrap break-words rounded-xl bg-zinc-950 p-5 pr-24 font-mono text-xs leading-6 text-zinc-100'>
        {json}
      </pre>
    </div>
  );
}

function SandboxPanel({
  row,
  profile,
  onClose,
}: {
  row: SdlcEnvironmentRow;
  profile: SandboxRepoOption;
  onClose: () => void;
}): ReactElement {
  const [tab, setTab] = useState('overview');
  // Full config is claw-admin only; everyone else gets the list fields, without step commands.
  const { user } = useAuth();
  const admin = useClawAdminAccessQuery(user?.id);
  const { data: config, isLoading } = useQuery({
    queryKey: ['claw-sandbox-repo', profile.key],
    queryFn: () =>
      clawApiRequest<ProfileConfig>(`/sandbox/repos/${encodeURIComponent(profile.key)}`),
    enabled: admin.isAdmin,
    retry: false,
  });
  const isPending = admin.isLoading || isLoading;

  return (
    <div className='h-full overflow-y-auto bg-background [scrollbar-gutter:stable]'>
      <header className='flex items-start gap-3 px-6 pb-4 pt-5'>
        <span className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
          <Server className='size-5' />
        </span>
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-2'>
            <h2 className='truncate text-lg font-semibold'>{profile.name}</h2>
            <code className='shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground'>
              {profile.key}
            </code>
          </div>
          <a
            href={webUrl(row.url)}
            target='_blank'
            rel='noreferrer'
            className='inline-flex max-w-full items-center gap-1 text-sm text-primary hover:underline'
          >
            <span className='truncate'>{shortUrl(row.url)}</span>
            <ArrowUpRight className='size-3.5 shrink-0' />
          </a>
        </div>
        <Button variant='ghost' size='sm' aria-label='Close' onClick={onClose}>
          <X className='size-4' />
        </Button>
      </header>
      {profile.description && (
        <div className='px-6'>
          <ClampText
            text={profile.description}
            className='text-sm leading-6 text-muted-foreground'
            trackName='Toggle sandbox description'
          />
        </div>
      )}
      <div className='sticky top-0 z-10 mt-3 bg-background px-6 py-2'>
        <Tabs
          items={[
            { id: 'overview', label: 'Overview' },
            { id: 'raw', label: 'Raw config' },
          ]}
          activeId={tab}
          onSelect={setTab}
          trackCategory='Environments'
        />
      </div>
      <div className='px-6 pb-8 pt-3'>
        {isPending ? (
          <div className='h-40 animate-pulse rounded-xl bg-muted/40' />
        ) : tab === 'overview' ? (
          <Overview config={config ?? profile} />
        ) : config ? (
          <RawConfig config={config} />
        ) : (
          <p className='text-sm text-muted-foreground'>Only claw admins can view the raw config.</p>
        )}
      </div>
    </div>
  );
}

function SandboxRow({
  profile,
  active,
  onSelect,
}: {
  profile: SandboxRepoOption;
  active: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
        active
          ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20'
          : 'border-border bg-background hover:bg-muted/40',
      )}
      data-track-category='Environments'
      data-track-name='Select sandbox'
    >
      <Server
        className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
      />
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium'>{profile.name}</span>
        {profile.defaultBranch && (
          <span className='flex items-center gap-1 truncate font-mono text-xs text-muted-foreground'>
            <GitBranch className='size-3 shrink-0' />
            {profile.defaultBranch}
          </span>
        )}
      </span>
      <ChevronRight className='size-4 shrink-0 text-muted-foreground' />
    </button>
  );
}

function BitbucketLogo({ className }: { className?: string }): ReactElement {
  return (
    <svg viewBox='0 0 24 24' className={className} aria-hidden fill='currentColor'>
      <path d='M2.65 3a.65.65 0 0 0-.65.75l2.73 16.56c.07.42.43.72.85.73h13.03c.32 0 .59-.23.64-.54L22 3.75A.65.65 0 0 0 21.35 3zm11.44 11.97H9.93l-1.12-5.88h6.28z' />
    </svg>
  );
}

function ProviderIcon({ url }: { url: string }): ReactElement {
  const host = repoUrlKey(url).split('/')[0] ?? '';
  if (host.includes('github')) return <Github className='size-5' />;
  if (host.includes('bitbucket')) return <BitbucketLogo className='size-5 text-[#2684FF]' />;
  return <BookMarked className='size-5' />;
}

function RepoGroup({
  row,
  linked,
  selectedKey,
  onSelect,
}: {
  row: SdlcEnvironmentRow;
  linked: SandboxRepoOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}): ReactElement {
  return (
    <section>
      <header className='flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3'>
        <span className='flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background'>
          <ProviderIcon url={row.url} />
        </span>
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate text-sm font-semibold'>{row.name}</span>
            <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'>
              {linked.length} {linked.length === 1 ? 'sandbox' : 'sandboxes'}
            </span>
          </div>
          <a
            href={webUrl(row.url)}
            target='_blank'
            rel='noreferrer'
            className='inline-flex max-w-full items-center gap-1 font-mono text-xs text-primary hover:underline'
          >
            <span className='truncate'>{shortUrl(row.url)}</span>
            <ArrowUpRight className='size-3 shrink-0' />
          </a>
        </div>
      </header>
      <ul className='ml-7'>
        {linked.length === 0 ? (
          <li className='relative pl-6 pt-2'>
            <span className='absolute left-0 top-0 h-[30px] w-px bg-border' aria-hidden />
            <span className='absolute left-0 top-[30px] h-px w-6 bg-border' aria-hidden />
            <span className='block rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground'>
              No sandbox profile clones this repository
            </span>
          </li>
        ) : (
          linked.map((profile, index) => {
            const active = profile.key === selectedKey;
            // The path from the repo down to the selected sandbox is highlighted.
            const activeIndex = linked.findIndex(p => p.key === selectedKey);
            return (
              <li key={profile.key} className='relative pl-6 pt-2'>
                <span
                  className={cn(
                    'absolute left-0 top-0 h-[34px] w-px',
                    index <= activeIndex ? 'bg-primary' : 'bg-border',
                  )}
                  aria-hidden
                />
                {/* The trunk stops at the last child's elbow. */}
                {index < linked.length - 1 && (
                  <span
                    className={cn(
                      'absolute bottom-0 left-0 top-[34px] w-px',
                      index < activeIndex ? 'bg-primary' : 'bg-border',
                    )}
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    'absolute left-0 top-[34px] h-px w-6',
                    active ? 'bg-primary' : 'bg-border',
                  )}
                  aria-hidden
                />
                <SandboxRow
                  profile={profile}
                  active={active}
                  onSelect={() => onSelect(profile.key)}
                />
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

/** Repository → Sandbox Profile links. `channelId` is the SDLC hub the view opens filtered to. */
export function EnvironmentsView({
  channelId,
  hubRepoIds,
  onAddRepository,
}: {
  channelId?: string | undefined;
  /** The hub's live repository ids; a change refetches the list. */
  hubRepoIds?: string[];
  onAddRepository?: () => void;
}): ReactElement {
  const [selection, setSelection] = useState<{ repoId: string; key: string } | null>(null);
  const [query, setQuery] = useState('');
  // Inside an SDLC hub the filter starts on that hub; it can be changed or cleared.
  const [hubFilter, setHubFilter] = useState<string | null>(channelId ?? null);
  const { data: rows, isPending } = useQuery({
    queryKey: ['sdlc-environments', hubRepoIds?.join(',') ?? null],
    queryFn: async () =>
      (await apiInstance.get<{ environments: SdlcEnvironmentRow[] }>('/sdlc/environments')).data
        .environments,
  });
  const [sdlcChannels] = useCachedQuery(queries.getSdlcChannels());
  const { data: profiles } = useSandboxRepos();
  const linkedByUrl = useMemo(() => {
    const byUrl = new Map<string, SandboxRepoOption[]>();
    for (const profile of profiles ?? []) {
      if (!profile.repoUrl) continue;
      const key = repoUrlKey(profile.repoUrl);
      byUrl.set(key, [...(byUrl.get(key) ?? []), profile]);
    }
    return byUrl;
  }, [profiles]);
  const linkedFor = (row: SdlcEnvironmentRow): SandboxRepoOption[] =>
    linkedByUrl.get(repoUrlKey(row.url)) ?? [];

  const hubOptions = Array.isArray(sdlcChannels) ? sdlcChannels : [];
  const hubLabel = hubOptions.find(option => option.id === hubFilter)?.name ?? 'All hubs';

  const q = query.trim().toLowerCase();
  const visible = (rows ?? []).filter(
    row =>
      (!hubFilter || row.hubChannelIds.includes(hubFilter)) &&
      (!q ||
        [row.name, row.url, ...linkedFor(row).flatMap(p => [p.key, p.name])].some(value =>
          value.toLowerCase().includes(q),
        )),
  );
  const selectedRow = rows?.find(row => row.repoId === selection?.repoId);
  const selectedProfile = selectedRow
    ? linkedFor(selectedRow).find(profile => profile.key === selection?.key)
    : undefined;

  return (
    <ResizableGroup orientation='horizontal' className='flex h-full w-full bg-background'>
      <Panel id='environments-list' minSize='35%'>
        <div className='h-full overflow-y-auto [scrollbar-gutter:stable]'>
          <div className='max-w-ai-content mx-auto flex min-h-full flex-col px-8 pb-8 pt-8'>
            <h1 className='text-2xl font-semibold tracking-tight'>Environments</h1>
            <p className='mt-1.5 text-sm leading-6 text-muted-foreground'>
              The sandboxes each repository&apos;s agents can boot into: source, boot steps and
              timeouts.
            </p>

            <div className='sticky top-0 z-10 -mx-1 flex items-center gap-3 bg-background px-1 pb-4 pt-5'>
              <div className='relative flex-1'>
                <Search className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
                <Input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder='Search repositories or sandboxes'
                  className='h-10 pl-9'
                />
              </div>
              <LibraryFilterMenu
                title='Hub'
                options={[
                  { id: 'all', label: 'All hubs' },
                  ...hubOptions.map(hub => ({
                    id: hub.id,
                    label: hub.name,
                    icon: channelIcon(hub.visibility),
                  })),
                ]}
                activeId={hubFilter}
                onSelect={setHubFilter}
                trackName='Filter environments by hub'
                searchable
              />
              {onAddRepository && hubFilter === channelId && (
                <>
                  <span className='h-6 w-px bg-border' aria-hidden />
                  <Button
                    onClick={onAddRepository}
                    className='h-10'
                    data-track-category='Environments'
                    data-track-name='Add repository'
                  >
                    <Plus className='size-4' />
                    Add repository
                  </Button>
                </>
              )}
            </div>

            <div className='flex flex-1 flex-col gap-5'>
              {isPending &&
                Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className='h-32 animate-pulse rounded-xl bg-muted/30' />
                ))}
              {!isPending && visible.length === 0 && (
                <div className='rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground'>
                  {rows?.length ? 'No repositories match.' : 'No repositories yet.'}
                </div>
              )}
              {visible.map(row => (
                <RepoGroup
                  key={row.repoId}
                  row={row}
                  linked={linkedFor(row)}
                  selectedKey={selection?.repoId === row.repoId ? selection.key : null}
                  onSelect={key =>
                    setSelection(current =>
                      current?.repoId === row.repoId && current.key === key
                        ? null
                        : { repoId: row.repoId, key },
                    )
                  }
                />
              ))}
              <p className='pt-1 text-xs text-muted-foreground'>
                {visible.length} {visible.length === 1 ? 'repository' : 'repositories'}
                {hubFilter ? ` in ${hubLabel}` : ''}
              </p>
            </div>
          </div>
        </div>
      </Panel>
      {selectedRow && selectedProfile && (
        <>
          <Separator className='w-px cursor-col-resize bg-border transition-colors hover:bg-primary active:bg-primary' />
          <Panel id='environments-detail' defaultSize='50%' minSize='30%'>
            <SandboxPanel
              key={`${selectedRow.repoId}:${selectedProfile.key}`}
              row={selectedRow}
              profile={selectedProfile}
              onClose={() => setSelection(null)}
            />
          </Panel>
        </>
      )}
    </ResizableGroup>
  );
}
