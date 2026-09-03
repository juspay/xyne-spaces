import { type ReactElement } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawAgentDetail } from '@/hooks/useClawAgentDetail';
import { Pill } from '../../shared/primitives/Pill';
import { LibraryIconTile } from '../../shared/components/LibraryCard';
import { AgentDetailHeaderV2 } from './AgentDetailHeaderV2';
import { AgentPersonaTabV2 } from './persona/AgentPersonaTabV2';
import { AgentActivityTabV2 } from './activity/AgentActivityTabV2';
import { AgentBehaviourTabV2 } from './behaviour/AgentBehaviourTabV2';
import { AgentKnowledgeTabV2 } from './knowledge/AgentKnowledgeTabV2';
import { AgentPeopleTabV2 } from './people/AgentPeopleTabV2';
import { AgentToolsTabV2 } from './tools/AgentToolsTabV2';
import { AGENT_DETAIL_TABS, resolveTab, type AgentDetailTabId } from './detailTabs';
import { useAgentDetailActions } from './useAgentDetailActions';

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
  return Number.isNaN(parsed.getTime()) ? null : DATE.format(parsed).replace(',', ',');
}

const ClawAgentDetailV2 = (): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaceId, slug } = useParams<{ workspaceId?: string; slug?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
  const requestedReturnPath = (location.state as { returnTo?: unknown } | null)?.returnTo;
  const navigationState: { returnTo: string } | null =
    typeof requestedReturnPath === 'string' && requestedReturnPath.startsWith('/')
      ? { returnTo: requestedReturnPath }
      : null;
  const returnPath = navigationState?.returnTo ?? `${libraryPath}?tab=agents`;
  const tab = resolveTab(searchParams.get('tab'));

  const { data: agent, isLoading, isError } = useClawAgentDetail(slug);
  const actions = useAgentDetailActions(agent);

  const setTab = (next: AgentDetailTabId): void => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true, state: navigationState });
  };

  const updated = formatUpdated(agent?.updatedAt);
  const version = agent?.activePromptVersion;

  return (
    <div className='h-full overflow-y-auto no-scrollbar' data-component='ClawAgentDetailV2'>
      <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6 pb-6'>
        <div className='bg-background sticky top-0 z-10 flex flex-col gap-6 pb-3 pt-6'>
          {agent && (
            <AgentDetailHeaderV2
              agent={agent}
              actions={actions}
              onBack={() => void navigate(returnPath)}
              onEdit={() => void navigate(`${libraryPath}/agent/${agent.slug}/edit`)}
            />
          )}

          <div className='flex w-full items-center gap-1'>
            {AGENT_DETAIL_TABS.map(entry => (
              <button
                key={entry.id}
                type='button'
                onClick={() => setTab(entry.id)}
                aria-current={entry.id === tab ? 'page' : undefined}
                data-track-category='Claw Agents'
                data-track-name={`Agent detail v2 tab: ${entry.label}`}
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
        ) : isError || !agent ? (
          <p className='py-16 text-center text-sm text-muted-foreground'>
            Couldn&apos;t load this agent.
          </p>
        ) : (
          <>
            <div className='flex w-full items-start gap-3'>
              <LibraryIconTile name={agent.name} color={agent.color || '#6366f1'} size='md' />

              <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
                <div className='flex min-w-0 items-center gap-2'>
                  <span className='truncate text-sm font-semibold leading-[22px] text-foreground'>
                    {agent.name}
                  </span>
                  <Pill tone={agent.enabled ? 'success' : 'neutral'}>
                    {agent.enabled ? 'Enabled' : 'Disabled'}
                  </Pill>
                </div>

                <div className='flex flex-wrap items-center gap-1.5 text-xs leading-[22px] text-foreground/80 opacity-70'>
                  <span>@{agent.slug}</span>
                  {version !== null && version !== undefined && (
                    <>
                      <span aria-hidden>·</span>
                      <span>v{version}</span>
                    </>
                  )}
                  {updated && (
                    <>
                      <span aria-hidden>·</span>
                      <span>Last updated on: {updated}</span>
                    </>
                  )}
                  <button
                    type='button'
                    data-track-category='Claw Agents'
                    data-track-name='Agent detail v2: version history'
                    className='underline underline-offset-2'
                  >
                    Version history
                  </button>
                </div>
              </div>
            </div>

            {tab === 'persona' ? (
              <AgentPersonaTabV2
                agent={agent}
                canEdit={actions.permissions?.canEdit ?? false}
                canManageCredentials={actions.isOwner || actions.isAdmin}
              />
            ) : tab === 'behaviour' ? (
              <AgentBehaviourTabV2 agent={agent} canEdit={actions.permissions?.canEdit ?? false} />
            ) : tab === 'tools' ? (
              <AgentToolsTabV2 agent={agent} canEdit={actions.permissions?.canEdit ?? false} />
            ) : tab === 'knowledge' ? (
              <AgentKnowledgeTabV2 agent={agent} canEdit={actions.permissions?.canEdit ?? false} />
            ) : tab === 'people' ? (
              <AgentPeopleTabV2 agent={agent} actions={actions} />
            ) : (
              <AgentActivityTabV2 agent={agent} canEdit={actions.permissions?.canEdit ?? false} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ClawAgentDetailV2;
