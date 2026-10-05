import { useState, type ReactElement } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawAgentDetail } from '@/hooks/useClawAgentDetail';
import { AgentDetailHeaderV2 } from './AgentDetailHeaderV2';
import { AgentSettingsModal } from './AgentSettingsModal';
import { BUILDER_DRIVER_SLUG } from './AgentBuilderPanel';
import { useAgentDetailActions } from './useAgentDetailActions';
import { useOpenAgentChat } from '@/hooks/useOpenAgentChat';
import ClawAgentCreateV2 from '../create/ClawAgentCreateV2';

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

  const { data: agent, isLoading, isError } = useClawAgentDetail(slug);
  const actions = useAgentDetailActions(agent);
  const canEdit = actions.permissions?.canEdit ?? false;
  const { canOpenAgentChat, openAgentChat } = useOpenAgentChat();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Delegation approvals spend the callee's credentials and quota, so the
  // inbox is the owner's (or an admin's) — mirrors claw's canManageRequests.
  const canManageDelegation = actions.isOwner || actions.isAdmin;

  const openBuilder = (): void => {
    const params = new URLSearchParams(searchParams);
    params.set('build', '1');
    setSearchParams(params, { replace: true, state: navigationState });
  };

  const builderOpen = searchParams.get('build') === '1';
  const canBuild = agent !== undefined && agent.slug !== BUILDER_DRIVER_SLUG && !builderOpen;

  return (
    <div className='flex h-full min-h-0 flex-col' data-component='ClawAgentDetailV2'>
      <div className='mx-auto w-full max-w-[720px] shrink-0 px-6 pt-5'>
        {agent && (
          <AgentDetailHeaderV2
            agent={agent}
            actions={actions}
            onChat={() => openAgentChat(agent.slug)}
            canChat={canOpenAgentChat}
            onBuild={canBuild ? openBuilder : undefined}
            onSettings={() => setSettingsOpen(true)}
            onBack={() => void navigate(returnPath)}
          />
        )}
      </div>

      {isLoading ? (
        <div className='mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-6'>
          <Skeleton className='size-14 rounded-xl' />
          <Skeleton className='h-7 w-52' />
          <Skeleton className='h-5 w-80' />
          <Skeleton className='h-32 w-full rounded-2xl' />
        </div>
      ) : isError || !agent ? (
        <p className='py-16 text-center text-sm text-muted-foreground'>
          Couldn&apos;t load this agent.
        </p>
      ) : (
        <div className='min-h-0 flex-1'>
          <ClawAgentCreateV2 agent={agent} hideBack />
        </div>
      )}

      {agent && (
        <AgentSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          agent={agent}
          actions={actions}
          canEdit={canEdit}
          canManageDelegation={canManageDelegation}
        />
      )}
    </div>
  );
};

export default ClawAgentDetailV2;
