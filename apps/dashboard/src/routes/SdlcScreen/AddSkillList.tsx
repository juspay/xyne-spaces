import { useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Search, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAuth } from '../../hooks/useAuth';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  importSkills,
  previewSkillImport,
  searchSkillSources,
  topSkillSources,
  type SkillSearchResult,
  type ImportPreview,
  type ImportPreviewSkill,
} from '../../services/claw/clawSkillsService';
import type { Skill } from '../../services/claw/clawSkillsTypes';
import { apiInstance } from '../../services/clients/apiClient';

/** Why a repo skill cannot be added, or null when it can. */
function importBlocked(skill: ImportPreviewSkill): string | null {
  if (skill.alreadyImported) return 'Already in your skills, listed above.';
  if (skill.error) return skill.error;
  if (!skill.slugValid) return 'Its name is not a valid skill handle.';
  if (skill.slugTaken) return 'Another skill already uses this name.';
  return null;
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact' });

// One height for every row in both sections, the placeholders included.
const rowClass = 'flex min-h-[4.5rem] items-center gap-3 rounded-lg px-2 py-3';

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong.';

interface Row {
  key: string;
  name: string;
  source: string;
  description?: string;
  /** In the hub, or added in this dialog. */
  added: boolean;
  /** Said in place of Add when it cannot be added. */
  reason?: string | null;
  /** Not global yet: Add asks first, then sends it to a claw admin. */
  needsApproval: boolean;
  /** Its skills.sh page, for search results only. */
  viewUrl?: string;
  add?: () => Promise<void>;
}

export function SkeletonRows({ count = 3 }: { count?: number }): ReactElement {
  return (
    <div aria-hidden className='flex flex-col'>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={rowClass}>
          <Skeleton className='size-8 shrink-0 rounded-lg' />
          <div className='flex flex-1 flex-col gap-1.5'>
            <Skeleton className='h-3.5 w-1/3' />
            <Skeleton className='h-3 w-2/3' />
          </div>
          <Skeleton className='h-8 w-16' />
        </div>
      ))}
    </div>
  );
}

/**
 * One search, one list and one Add for every way a skill reaches this hub. Hub admins only.
 * Without `channelId` it only imports into the user's own skills: no Your skills section, no link,
 * no approval.
 */
export function AddSkillList(props: {
  channelId?: string;
  catalog?: Skill[] | undefined;
  catalogFailed?: boolean;
  linkedIds?: Set<string>;
  /** Asks before a skill goes to a claw admin; false when the admin cancels. */
  confirmApproval?: (name: string) => Promise<boolean>;
  /** Sends the request to make it global. Says its outcome itself and never throws. */
  requestApproval?: (slug: string) => Promise<void>;
}): ReactElement {
  const { channelId, linkedIds = new Set<string>(), requestApproval } = props;
  const hub = Boolean(channelId);
  const action = hub ? 'Add' : 'Import';
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  // Rows added here: they read Added at once and go back on a failure.
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const q = query.trim();
  const isLink = q.includes('/');
  const remote = useDebouncedValue(q, 300);
  // Under 300 ms nothing shows; a slower answer gets row-shaped placeholders.
  const search = useQuery({
    queryKey: ['skill-source-search', remote],
    queryFn: () => searchSkillSources(remote, userId),
    enabled: !isLink && remote.length >= 2 && remote === q,
    staleTime: 60_000,
  });
  // An empty search shows what is popular on skills.sh instead of nothing.
  const top = useQuery({
    queryKey: ['skill-source-top'],
    queryFn: () => topSkillSources(userId),
    enabled: q === '',
    staleTime: 60 * 60 * 1000,
  });
  const topLoading = q === '' && top.isLoading;
  const showTopSkeleton = useDebouncedValue(topLoading, 300) && topLoading;
  const previewOf = (link: string): Promise<ImportPreview> =>
    queryClient.fetchQuery({
      queryKey: ['skill-import-preview', link],
      queryFn: () => previewSkillImport(link, userId),
      staleTime: 60_000,
    });
  const preview = useQuery({
    queryKey: ['skill-import-preview', remote],
    queryFn: () => previewSkillImport(remote, userId),
    enabled: isLink && remote === q,
    staleTime: 60_000,
    retry: false,
  });
  const remoteLoading =
    (isLink ? preview.isFetching : search.isFetching) || (q.length >= 2 && remote !== q);
  const showSkeleton = useDebouncedValue(remoteLoading, 300) && remoteLoading;
  const catalogLoading = !props.catalog && !props.catalogFailed;
  const showCatalogSkeleton = useDebouncedValue(catalogLoading, 300) && catalogLoading;

  const refetch = (): Promise<unknown> =>
    Promise.all([
      ...(hub
        ? [queryClient.invalidateQueries({ queryKey: ['sdlc-hub-knowledge', channelId] })]
        : []),
      queryClient.invalidateQueries({ queryKey: ['claw-skills'] }),
    ]);
  const link = (skillId: string): Promise<unknown> =>
    apiInstance.post(`/sdlc/channels/${encodeURIComponent(channelId ?? '')}/knowledge/skills`, {
      skillId,
    });
  const importAndLink = async (
    url: string,
    sha: string,
    skill: ImportPreviewSkill,
  ): Promise<void> => {
    const result = await importSkills(
      { url, sha, skills: [{ path: skill.path, slug: skill.name }] },
      userId,
    );
    const created = result.imported[0];
    if (!created) throw new Error(result.failed[0]?.error ?? 'It was not imported.');
    if (!hub) return;
    await link(created.id);
    // An import is always personal, so it reaches runs only once a claw admin approves it.
    await requestApproval?.(created.slug);
  };
  const run = (row: Pick<Row, 'key' | 'name'>, work: () => Promise<void>): Promise<void> => {
    setAdded(current => new Set(current).add(row.key));
    return work().then(
      () => void refetch(),
      error => {
        setAdded(current => {
          const next = new Set(current);
          next.delete(row.key);
          return next;
        });
        toast.error(
          `Could not ${action.toLowerCase()} "${row.name}". ${errorText(error)} Try again.`,
        );
      },
    );
  };

  const addRow = async (row: Row): Promise<void> => {
    if (!row.add) return;
    if (hub && row.needsApproval && !(await props.confirmApproval?.(row.name))) return;
    await run(row, row.add);
  };

  const needle = q.toLowerCase();
  const mine: Row[] =
    isLink || !hub
      ? []
      : (props.catalog ?? [])
          .filter(
            skill =>
              skill.enabled &&
              `${skill.name} ${skill.slug} ${skill.description}`.toLowerCase().includes(needle),
          )
          .map(skill => ({
            key: `mine:${skill.id}`,
            name: skill.name || skill.slug,
            source:
              skill.scope === 'global'
                ? 'Global skill · Adds now'
                : 'Personal skill · Needs claw-admin approval',
            description: skill.description,
            added: linkedIds.has(skill.id),
            needsApproval: skill.scope !== 'global',
            add: async (): Promise<void> => {
              await link(skill.id);
              if (skill.scope !== 'global') await requestApproval?.(skill.slug);
            },
          }))
          // The ones that can still be added come first. The sort is stable.
          .sort((a, b) => Number(a.added) - Number(b.added));

  /** A skills.sh search or leaderboard entry: imported from its repo on Add. */
  const shRow = (result: SkillSearchResult): Row => {
    const key = `sh:${result.source}/${result.skillId}`;
    return {
      key,
      name: result.name,
      source: `${result.source} · ${compact.format(result.installs)} installs`,
      added: false,
      reason: reasons[key] ?? null,
      needsApproval: true,
      viewUrl: `https://skills.sh/${[...result.source.split('/'), result.skillId].map(encodeURIComponent).join('/')}`,
      // The repo is read only on Add: a search lists names, not what the import would hit.
      add: async (): Promise<void> => {
        const data = await previewOf(result.source);
        const skill = data.skills.find(candidate => candidate.name === result.skillId);
        const blocked = skill ? importBlocked(skill) : 'Not found in its repository.';
        if (blocked !== null || !skill) {
          const why = blocked ?? 'Not found in its repository.';
          setReasons(current => ({ ...current, [key]: why }));
          throw new Error(why);
        }
        await importAndLink(result.source, data.sha, skill);
      },
    };
  };
  const topRows = q === '' ? (top.data ?? []).map(shRow) : [];

  const remoteRows: Row[] = isLink
    ? [...(preview.data?.skills ?? [])]
        // A skills.sh link to one skill puts that skill first.
        .sort(
          (a, b) => Number(b.name === preview.data?.skill) - Number(a.name === preview.data?.skill),
        )
        .map(skill => {
          const data = preview.data as ImportPreview;
          return {
            key: `repo:${data.owner}/${data.repo}/${skill.path}`,
            name: skill.name,
            source: `${data.owner}/${data.repo}${skill.path ? `/${skill.path}` : ''}`,
            description: skill.description,
            added: false,
            reason: importBlocked(skill),
            needsApproval: true,
            add: () => importAndLink(q, data.sha, skill),
          };
        })
    : (search.data ?? []).map(shRow);

  const renderRow = (row: Row): ReactElement => {
    const done = row.added || added.has(row.key);
    return (
      <div key={row.key} className={`${rowClass} hover:bg-muted/40`}>
        <div className='grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground'>
          <Wrench size={16} />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium' title={row.name}>
            {row.name}
          </p>
          <p className='line-clamp-2 text-xs text-muted-foreground'>
            {row.source}
            {row.description && ` — ${row.description}`}
          </p>
        </div>
        {row.viewUrl && (
          <a
            href={row.viewUrl}
            target='_blank'
            rel='noopener noreferrer'
            aria-label={`View ${row.name} on skills.sh`}
            data-track-category='SdlcHub'
            data-track-name='HubSkillViewOnSkillsSh'
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <ExternalLink size={14} />
            View
          </a>
        )}
        {done ? (
          <span className='flex shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground'>
            <Check size={13} />
            {hub ? 'Added' : 'Imported'}
          </span>
        ) : row.reason ? (
          <span className='max-w-[12rem] shrink-0 text-right text-xs text-muted-foreground'>
            {row.reason}
          </span>
        ) : (
          <Button
            type='button'
            size='sm'
            variant='outline'
            aria-label={`${action} ${row.name}`}
            onClick={() => void addRow(row)}
            data-track-category='SdlcHub'
            data-track-name={
              row.key.startsWith('mine:') ? 'HubKnowledgeSkillLinked' : 'HubKnowledgeSkillImported'
            }
          >
            {action}
          </Button>
        )}
      </div>
    );
  };

  const heading = (text: string): ReactElement => (
    <h3 className='px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground first:pt-0'>{text}</h3>
  );
  const note = (text: string): ReactElement => (
    <p className='px-2 py-3 text-sm text-muted-foreground'>{text}</p>
  );
  const remoteError = isLink ? preview.error : search.error;

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3'>
      <div className='relative'>
        <Search
          size={14}
          className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'
        />
        <Input
          autoFocus
          className='h-9 pl-9'
          placeholder={
            hub
              ? 'Search your skills or skills.sh, or paste a GitHub / skills.sh link'
              : 'Search skills.sh, or paste a GitHub / skills.sh link'
          }
          aria-label={
            hub
              ? 'Search your skills or skills.sh, or paste a GitHub or skills.sh link'
              : 'Search skills.sh, or paste a GitHub or skills.sh link'
          }
          value={query}
          onChange={event => setQuery(event.target.value)}
          data-track-category='SdlcHub'
          data-track-name='HubKnowledgeSkillSearched'
        />
      </div>
      {/* Only the list scrolls; the dialog keeps its height whatever it holds. */}
      <div className='-mx-2 min-h-0 flex-1 overflow-auto pr-2'>
        {!hub &&
          q.length < 2 &&
          topRows.length === 0 &&
          !topLoading &&
          note('Search skills.sh, or paste a GitHub or skills.sh link.')}
        {hub && !isLink && (
          <>
            {heading('Your skills')}
            {!props.catalog
              ? props.catalogFailed
                ? note('Could not load your skills. Reload to try again.')
                : showCatalogSkeleton && <SkeletonRows />
              : mine.length > 0
                ? mine.map(renderRow)
                : note(q ? `None of your skills match "${q}".` : 'You have no skills yet.')}
          </>
        )}
        {q === '' && (topLoading || topRows.length > 0) && (
          <>
            {heading('Top on skills.sh')}
            {topLoading ? showTopSkeleton && <SkeletonRows /> : topRows.map(renderRow)}
          </>
        )}
        {(isLink || q.length >= 2) && (
          <>
            {heading(
              isLink && preview.data
                ? `From ${preview.data.owner}/${preview.data.repo}`
                : isLink
                  ? 'From this link'
                  : 'From skills.sh',
            )}
            {showSkeleton ? (
              <SkeletonRows />
            ) : remoteLoading ? null : remoteError && isLink ? (
              note(`${errorText(remoteError)}`)
            ) : remoteError ? (
              <p className='flex items-center gap-1 px-2 py-3 text-sm text-muted-foreground'>
                Could not search skills.sh.
                <Button
                  type='button'
                  variant='link'
                  size='inline'
                  className='p-0 text-sm'
                  onClick={() => void search.refetch()}
                >
                  Try again
                </Button>
              </p>
            ) : remoteRows.length > 0 ? (
              remoteRows.map(renderRow)
            ) : (
              note(isLink ? 'No skills in this repository.' : 'No skills.sh results.')
            )}
          </>
        )}
      </div>
    </div>
  );
}
