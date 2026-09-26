import { type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronBigLeft } from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { Pill } from '../../shared/primitives/Pill';
import { LibraryIconTile } from '../../shared/components/LibraryCard';
import { useSkillCatalog } from '../../shared/pickers/skill/useSkillCatalog';
import { SkillContextTabV2 } from './context/SkillContextTabV2';
import { SkillOverviewTabV2 } from './overview/SkillOverviewTabV2';
import { resolveSkillTab, SKILL_DETAIL_TABS, type SkillDetailTabId } from './skillDetailTabs';
import { useSkillDetailActions } from './useSkillDetailActions';

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatCreated(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : DATE.format(parsed);
}

function formatUpdated(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : DATE_TIME.format(parsed);
}

const ClawSkillDetailV2 = (): ReactElement => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = resolveSkillTab(searchParams.get('tab'));
  const { entries, loading, isError } = useSkillCatalog();
  const entry = entries.find(candidate => candidate.slug === slug);
  const skill = entry?.skill;
  const actions = useSkillDetailActions(skill);

  const setTab = (next: SkillDetailTabId): void => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const created = formatCreated(skill?.createdAt);
  const updated = formatUpdated(skill?.updatedAt);
  const author = skill?.owner?.name ?? skill?.owner?.email ?? null;

  return (
    <div className='h-full overflow-y-auto no-scrollbar' data-component='ClawSkillDetailV2'>
      <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6 pb-6'>
        <div className='bg-background sticky top-0 z-10 flex flex-col gap-6 pb-3 pt-6'>
          <div className='flex w-full items-center justify-between gap-4'>
            <button
              type='button'
              onClick={() => void navigate(`${actions.libraryPath}?tab=skills`)}
              data-track-category='Claw Agents'
              data-track-name='Skill detail v2: back'
              className='flex h-7 shrink-0 items-center rounded-[10px] pr-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            >
              <span className='flex h-7 w-[22px] shrink-0 items-center justify-center'>
                <ChevronBigLeft className='size-4' aria-hidden />
              </span>
              <span className='text-base font-semibold leading-6 tracking-[-0.32px] text-foreground'>
                Skills
              </span>
            </button>

            {skill && actions.canEdit && (
              <button
                type='button'
                role='switch'
                aria-checked={skill.enabled}
                aria-label={skill.enabled ? 'Disable skill' : 'Enable skill'}
                disabled={actions.busy.toggling}
                onClick={() => void actions.toggleEnabled(!skill.enabled)}
                data-track-category='Claw Agents'
                data-track-name='Skill detail v2: toggle enabled'
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
                  skill.enabled ? 'bg-foreground' : 'bg-border',
                )}
              >
                <span
                  className={cn(
                    'inline-block size-4 rounded-full bg-background shadow-sm transition-transform',
                    skill.enabled ? 'translate-x-[18px]' : 'translate-x-0.5',
                  )}
                />
              </button>
            )}
          </div>

          <div className='flex w-full items-center gap-1'>
            {SKILL_DETAIL_TABS.map(entryTab => (
              <button
                key={entryTab.id}
                type='button'
                onClick={() => setTab(entryTab.id)}
                aria-current={entryTab.id === tab ? 'page' : undefined}
                data-track-category='Claw Agents'
                data-track-name={`Skill detail v2 tab: ${entryTab.label}`}
                className={cn(
                  'flex h-8 items-center justify-center rounded-[10px] px-3 py-1 text-sm transition-colors',
                  entryTab.id === tab
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {entryTab.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className='flex w-full flex-col gap-4'>
            <Skeleton className='size-10 rounded-xl' />
            <Skeleton className='h-6 w-52' />
            <Skeleton className='h-4 w-80' />
            <Skeleton className='h-32 w-full rounded-2xl' />
          </div>
        ) : isError || !skill || !entry ? (
          <p className='py-16 text-center text-sm text-muted-foreground'>
            Couldn&apos;t load this skill.
          </p>
        ) : (
          <>
            <div className='flex w-full items-start gap-3'>
              <LibraryIconTile name={skill.name || skill.slug} size='md' />

              <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
                <div className='flex min-w-0 items-center gap-2'>
                  <span className='truncate text-sm font-semibold leading-[22px] text-foreground'>
                    {entry.label}
                  </span>
                  <Pill tone={skill.enabled ? 'success' : 'neutral'}>
                    {skill.enabled ? 'Active' : 'Disabled'}
                  </Pill>
                  {actions.busy.toggling && (
                    <Loader2 className='size-3.5 animate-spin text-muted-foreground' aria-hidden />
                  )}
                </div>

                <div className='flex flex-wrap items-center gap-1.5 text-xs leading-[22px] text-foreground/80 opacity-70'>
                  <span>/{skill.slug}</span>
                  {author && (
                    <>
                      <span aria-hidden>·</span>
                      <span>Created by {author}</span>
                    </>
                  )}
                  {created && (
                    <>
                      <span aria-hidden>·</span>
                      <span>Created on {created}</span>
                    </>
                  )}
                  {updated && (
                    <>
                      <span aria-hidden>·</span>
                      <span>Last updated on: {updated}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {tab === 'overview' ? (
              <SkillOverviewTabV2 skill={skill} actions={actions} />
            ) : (
              <SkillContextTabV2 skill={skill} actions={actions} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ClawSkillDetailV2;
