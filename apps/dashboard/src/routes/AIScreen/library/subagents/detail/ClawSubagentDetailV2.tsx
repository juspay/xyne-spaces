import { type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Network } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawSubagentDetail } from '@/hooks/useClawSubagents';
import { Pill } from '../../shared/primitives/Pill';
import { LibraryIconTile } from '../../shared/components/LibraryCard';
import { DetailTabPlaceholder } from '../../shared/primitives/DetailPrimitives';
import { SubagentDetailHeaderV2 } from './SubagentDetailHeaderV2';
import { SubagentContributorsTabV2 } from './contributors/SubagentContributorsTabV2';
import { SubagentKnowledgeTabV2 } from './knowledge/SubagentKnowledgeTabV2';
import { SubagentPersonaTabV2 } from './persona/SubagentPersonaTabV2';
import { SubagentToolsTabV2 } from './tools/SubagentToolsTabV2';
import {
  resolveSubagentTab,
  SUBAGENT_DETAIL_TABS,
  type SubagentDetailTabId,
} from './subagentDetailTabs';
import { useSubagentDetailActions } from './useSubagentDetailActions';

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatUpdated(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : DATE.format(parsed);
}

const ClawSubagentDetailV2 = (): ReactElement => {
  const navigate = useNavigate();
  const { name } = useParams<{ name?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = resolveSubagentTab(searchParams.get('tab'));
  const { data: subagent, isLoading, isError } = useClawSubagentDetail(name);
  const actions = useSubagentDetailActions(subagent);

  const setTab = (next: SubagentDetailTabId): void => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const canEdit = actions.permissions?.canEdit ?? false;
  const isBuiltIn = actions.permissions?.isBuiltIn ?? false;
  const updated = formatUpdated(subagent?.updatedAt);
  const toolCount = (subagent?.tools?.direct?.length ?? 0) + (subagent?.tools?.custom?.length ?? 0);

  return (
    <div className='h-full overflow-y-auto no-scrollbar' data-component='ClawSubagentDetailV2'>
      <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6 pb-6'>
        <div className='bg-background sticky top-0 z-10 flex flex-col gap-6 pb-3 pt-6'>
          {subagent && (
            <SubagentDetailHeaderV2
              subagent={subagent}
              actions={actions}
              onBack={() => void navigate(`${actions.libraryPath}?tab=subagents`)}
              onEdit={() =>
                void navigate(
                  `${actions.libraryPath}/subagent/${encodeURIComponent(subagent.name)}/edit`,
                )
              }
            />
          )}

          <div className='flex w-full items-center gap-1'>
            {SUBAGENT_DETAIL_TABS.map(entry => (
              <button
                key={entry.id}
                type='button'
                onClick={() => setTab(entry.id)}
                aria-current={entry.id === tab ? 'page' : undefined}
                data-track-category='Claw Agents'
                data-track-name={`Subagent detail v2 tab: ${entry.label}`}
                className={cn(
                  'flex h-8 items-center justify-center rounded-[10px] px-3 py-1 text-sm transition-colors',
                  entry.id === tab
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className='flex w-full flex-col gap-4'>
            <Skeleton className='size-10 rounded-xl' />
            <Skeleton className='h-6 w-52' />
            <Skeleton className='h-4 w-80' />
            <Skeleton className='h-32 w-full rounded-2xl' />
          </div>
        ) : isError || !subagent ? (
          <p className='py-16 text-center text-sm text-muted-foreground'>
            Couldn&apos;t load this subagent.
          </p>
        ) : (
          <>
            <div className='flex w-full items-start gap-3'>
              <LibraryIconTile size='md'>
                <Network className='size-4' aria-hidden />
              </LibraryIconTile>

              <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
                <div className='flex min-w-0 items-center gap-2'>
                  <span className='truncate text-sm font-semibold leading-[22px] text-foreground'>
                    {subagent.name}
                  </span>
                  <Pill tone={subagent.enabled ? 'success' : 'neutral'}>
                    {subagent.enabled ? 'Enabled' : 'Disabled'}
                  </Pill>
                </div>

                <div className='flex flex-wrap items-center gap-1.5 text-xs leading-[22px] text-foreground/80 opacity-70'>
                  <span>{isBuiltIn ? 'Built-in' : 'Custom'}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {subagent.skills.length} skill{subagent.skills.length === 1 ? '' : 's'}
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    {toolCount} tool{toolCount === 1 ? '' : 's'}
                  </span>
                  {subagent.createdByName && (
                    <>
                      <span aria-hidden>·</span>
                      <span>By {subagent.createdByName}</span>
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

            {tab === 'persona' ? (
              <SubagentPersonaTabV2 subagent={subagent} canEdit={canEdit} isBuiltIn={isBuiltIn} />
            ) : tab === 'knowledge' ? (
              <SubagentKnowledgeTabV2 subagent={subagent} canEdit={canEdit} isBuiltIn={isBuiltIn} />
            ) : tab === 'tools' ? (
              <SubagentToolsTabV2 subagent={subagent} canEdit={canEdit} isBuiltIn={isBuiltIn} />
            ) : tab === 'contributors' ? (
              <SubagentContributorsTabV2
                subagent={subagent}
                canShare={actions.permissions?.canShare ?? false}
                isBuiltIn={isBuiltIn}
              />
            ) : (
              <DetailTabPlaceholder
                label={SUBAGENT_DETAIL_TABS.find(entry => entry.id === tab)?.label ?? ''}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ClawSubagentDetailV2;
