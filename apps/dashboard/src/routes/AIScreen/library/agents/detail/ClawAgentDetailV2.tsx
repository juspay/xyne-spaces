import { type ReactElement } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawAgentDetail } from '@/hooks/useClawAgentDetail';
import { Pill } from '../../shared/primitives/Pill';
import { LibraryIconTile } from '../../shared/components/LibraryCard';
import { isSpacesRegistered } from './agentRegistration';
import { AgentDetailHeaderV2 } from './AgentDetailHeaderV2';
import { BUILDER_DRIVER_SLUG } from './AgentBuilderPanel';
import { AgentPersonaTabV2 } from './persona/AgentPersonaTabV2';
import { AgentActivityTabV2 } from './activity/AgentActivityTabV2';
import { AgentBehaviourTabV2 } from './behaviour/AgentBehaviourTabV2';
import { AgentKnowledgeTabV2 } from './knowledge/AgentKnowledgeTabV2';
import { AgentPeopleTabV2 } from './people/AgentPeopleTabV2';
import { AgentToolsTabV2 } from './tools/AgentToolsTabV2';
import { AGENT_DETAIL_TABS, resolveTab, type AgentDetailTabId } from './detailTabs';
import { AgentCallGraphTabV2 } from './callGraph/AgentCallGraphTabV2';
import { useAgentDetailActions } from './useAgentDetailActions';
import { useOpenAgentChat } from '@/hooks/useOpenAgentChat';

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
  const pendingRegistration = agent !== undefined && !isSpacesRegistered(agent);
  const actions = useAgentDetailActions(agent);
  const { canOpenAgentChat, openAgentChat } = useOpenAgentChat();

  // Delegation approvals spend the callee's credentials and quota, so the
  // inbox is the owner's (or an admin's) — mirrors claw's canManageRequests.
  const canManageDelegation = actions.isOwner || actions.isAdmin;
  const visibleTabs = AGENT_DETAIL_TABS.filter(entry => !entry.ownerOnly || canManageDelegation);

  const setTab = (next: AgentDetailTabId): void => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true, state: navigationState });
  };

  const openBuilder = (): void => {
    const params = new URLSearchParams(searchParams);
    params.set('build', '1');
    setSearchParams(params, { replace: true, state: navigationState });
  };

  const builderOpen = searchParams.get('build') === '1';
  const canBuild = agent !== undefined && agent.slug !== BUILDER_DRIVER_SLUG && !builderOpen;

  const updated = formatUpdated(agent?.updatedAt);
  const version = agent?.activePromptVersion;

  return (
    <div className='h-full overflow-y-auto no-scrollbar' data-component='ClawAgentDetailV2'>
      <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6'>
        <div className='bg-background sticky top-0 z-10 flex flex-col gap-6 pb-3 pt-6'>
          {agent && (
            <AgentDetailHeaderV2
              agent={agent}
              actions={actions}
              onChat={() => openAgentChat(agent.slug)}
              canChat={canOpenAgentChat}
              onBuild={canBuild ? openBuilder : undefined}
              onBack={() => void navigate(returnPath)}
            />
          )}

          <div className='flex w-full items-center gap-1'>
            {visibleTabs.map(entry => (
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
            <div className='flex w-full items-start gap-4'>
              <LibraryIconTile name={agent.name} color={agent.color || '#6366f1'} size='lg' />

              <div className='flex min-w-0 flex-1 flex-col gap-1 overflow-hidden'>
                <div className='flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1'>
                  <h2 className='truncate text-lg font-semibold leading-7 tracking-[-0.2px] text-foreground'>
                    {agent.name}
                  </h2>
                  <span className='truncate text-sm leading-6 text-muted-foreground'>
                    @{agent.slug}
                  </span>
                  <span className='self-center'>
                    <Pill tone={agent.enabled ? 'success' : 'neutral'}>
                      {agent.enabled ? 'Enabled' : 'Disabled'}
                    </Pill>
                  </span>
                </div>

                <div className='flex flex-wrap items-center gap-1.5 text-xs leading-5 text-muted-foreground'>
                  {version !== null && version !== undefined && <span>v{version}</span>}
                  {version !== null && version !== undefined && updated && (
                    <span aria-hidden>·</span>
                  )}
                  {updated && <span>Last updated on: {updated}</span>}
                  <span aria-hidden>·</span>
                  <button
                    type='button'
                    data-track-category='Claw Agents'
                    data-track-name='Agent detail v2: version history'
                    className='underline underline-offset-2 transition-colors hover:text-foreground'
                  >
                    Version history
                  </button>
                </div>

                {pendingRegistration && (
                  <p className='text-xs leading-[18px] text-muted-foreground/70'>
                    Chat works now. An admin needs to register this agent before it can be
                    @mentioned in Spaces.
                  </p>
                )}
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
            ) : tab === 'call-graph' && canManageDelegation ? (
              <AgentCallGraphTabV2 agent={agent} />
            ) : (
              <AgentActivityTabV2 agent={agent} canEdit={actions.permissions?.canEdit ?? false} />
            )}
          </>
        )}

        <div className='h-12 shrink-0' aria-hidden />
      </div>
    </div>
  );
};

export default ClawAgentDetailV2;
