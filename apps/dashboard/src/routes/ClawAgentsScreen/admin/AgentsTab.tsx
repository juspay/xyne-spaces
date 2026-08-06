import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronDown,
  DeleteDustbin01,
  PhotoImagePlus,
  PluginAddonDefault,
  Slack,
  UserArrowDown,
  UserArrowUp,
} from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import Tooltip from '@/components/ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { clawErrorText } from '@/services/claw/clawRequest';
import { listClawAuthAgents } from '@/services/claw/clawAuthAgentsService';
import { deleteAgent, demoteAgent, promoteAgent } from '@/services/claw/clawAdminService';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AdminOrgScope } from '@/services/claw/clawAdminTypes';
import { OrgBadge } from './components/AdminTable';
import { TabMessage } from './components/TabMessage';
import { RegistrationFlowCard } from './components/RegistrationFlowCard';
import { adminAgentsKey, adminAgentsPrefix } from './hooks/adminQueryKeys';
import { orgLabel } from './orgLabel';
import type { AgentRegistration } from './hooks/useAgentRegistration';

const isRegistered = (agent: Agent): boolean =>
  Boolean(agent.spacesAppId) && (agent.spacesAppTokenConfigured ?? Boolean(agent.spacesAppToken));

function AgentRow({
  agent,
  actions,
  showRegistration,
  showOrgLabels,
  orgNamesById,
}: {
  agent: Agent;
  actions: ReactElement;
  showRegistration: boolean;
  showOrgLabels: boolean;
  orgNamesById: Record<string, string>;
}): ReactElement {
  const visibleOrgName = orgLabel(agent.orgId, agent.orgName, orgNamesById);
  const ownerLabel = agent.owner?.name ?? agent.owner?.email ?? 'Unknown owner';

  return (
    <li className='flex items-center justify-between gap-3 border-b border-border px-1 py-4'>
      <div className='flex min-w-0 items-center gap-3'>
        <span
          className='inline-block size-3 shrink-0 rounded-full'
          style={{ backgroundColor: agent.color }}
          aria-hidden
        />
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <span className='truncate text-sm font-medium text-foreground'>{agent.name}</span>
          {showOrgLabels && visibleOrgName && <OrgBadge orgName={visibleOrgName} />}
          {showRegistration ? (
            <Badge variant={isRegistered(agent) ? 'default' : 'secondary'}>
              {isRegistered(agent) ? 'Registered' : 'Not registered'}
            </Badge>
          ) : (
            agent.ownerUserId && (
              <span className='truncate text-xs text-muted-foreground'>owner: {ownerLabel}</span>
            )
          )}
        </div>
      </div>
      <div className='flex shrink-0 items-center gap-2'>{actions}</div>
    </li>
  );
}

function AgentSection({
  heading,
  agents,
  emptyText,
  renderActions,
  showRegistration,
  showOrgLabels,
  orgNamesById,
}: {
  heading: string;
  agents: Agent[];
  emptyText: string;
  renderActions: (agent: Agent) => ReactElement;
  showRegistration: boolean;
  showOrgLabels: boolean;
  orgNamesById: Record<string, string>;
}): ReactElement {
  return (
    <section className='flex flex-col gap-3'>
      <h3 className='text-sm font-semibold text-foreground'>
        {heading} ({agents.length})
      </h3>
      {agents.length === 0 ? (
        <p className='text-xs text-muted-foreground'>{emptyText}</p>
      ) : (
        <ul className='flex flex-col'>
          {agents.map(agent => (
            <AgentRow
              key={agent.id}
              agent={agent}
              actions={renderActions(agent)}
              showRegistration={showRegistration}
              showOrgLabels={showOrgLabels}
              orgNamesById={orgNamesById}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function AgentsTab({
  userId,
  scope,
  orgId,
  orgNamesById,
  showOrgLabels,
  registration,
}: {
  userId: string;
  scope: AdminOrgScope;
  orgId: string | null;
  orgNamesById: Record<string, string>;
  showOrgLabels: boolean;
  registration: AgentRegistration;
}): ReactElement {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);

  const {
    data: agents,
    isPending,
    isError,
  } = useQuery({
    queryKey: adminAgentsKey(userId, scope),
    queryFn: () => listClawAuthAgents(userId, { allAgents: true, orgScope: scope }),
  });

  const visible = useMemo(
    () => (orgId ? (agents ?? []).filter(agent => agent.orgId === orgId) : (agents ?? [])),
    [agents, orgId],
  );

  const globalAgents = useMemo(() => visible.filter(agent => agent.scope === 'global'), [visible]);
  const personalAgents = useMemo(
    () => visible.filter(agent => agent.scope !== 'global'),
    [visible],
  );

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: adminAgentsPrefix(userId) });
  };

  const promote = useMutation({
    mutationFn: (slug: string) => promoteAgent(userId, slug),
    onSuccess: () => {
      toast.success('Agent promoted to global');
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not promote the agent')),
  });

  const demote = useMutation({
    mutationFn: (slug: string) => demoteAgent(userId, slug),
    onSuccess: () => {
      toast.success('Agent demoted');
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not demote the agent')),
  });

  const remove = useMutation({
    mutationFn: (slug: string) => deleteAgent(userId, slug),
    onSuccess: () => {
      toast.success('Agent deleted');
      setDeleteTarget(null);
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not delete the agent')),
  });

  if (isPending) return <Skeleton className='mt-4 h-40 w-full' />;
  if (isError) return <TabMessage>Couldn’t load agents.</TabMessage>;

  const busy = promote.isPending || demote.isPending || remove.isPending;

  const iconAction = (
    label: string,
    icon: ReactElement,
    onClick: () => void,
    options: {
      disabled?: boolean;
      danger?: boolean;
      showLabel?: boolean;
      trackName?: string;
    } = {},
  ): ReactElement => {
    const button = (
      <Button
        type='button'
        variant='ghost'
        size={options.showLabel ? 'sm' : 'icon'}
        disabled={options.disabled ?? busy}
        onClick={onClick}
        aria-label={label}
        data-track-category='Claw Admin'
        data-track-name={options.trackName ?? label}
        className={cn(
          'focus-visible:bg-muted focus-visible:ring-0',
          options.danger
            ? 'text-muted-foreground hover:text-destructive'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {icon}
        {options.showLabel && <span>{label}</span>}
      </Button>
    );

    return options.showLabel ? (
      button
    ) : (
      <Tooltip content={label} side='top'>
        {button}
      </Tooltip>
    );
  };

  const registerMenu = (agent: Agent): ReactElement => {
    const registered = isRegistered(agent);
    const hasApp = Boolean(agent.spacesAppId);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            disabled={busy}
            data-track-category='Claw Admin'
            data-track-name='Register agent'
            className='text-muted-foreground hover:text-foreground focus-visible:bg-muted focus-visible:ring-0'
          >
            <PluginAddonDefault className='size-4 text-current' />
            <span className='text-current'>
              {hasApp && !registered ? 'Resume setup' : 'Register'}
            </span>
            <ChevronDown className='size-4 text-current' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem
            disabled={registered}
            onSelect={() => registration.start(agent)}
            className='data-[disabled]:pointer-events-auto data-[disabled]:cursor-not-allowed'
          >
            <PluginAddonDefault className='mr-2 size-4' />
            {registered ? 'Spaces (registered)' : hasApp ? 'Spaces (resume setup)' : 'Spaces'}
          </DropdownMenuItem>
          <DropdownMenuItem disabled className='hidden'>
            <Slack className='mr-2 size-4' />
            Add to Slack
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className='flex flex-col gap-8 pt-4'>
      {registration.flow && (
        <RegistrationFlowCard
          flow={registration.flow}
          onRun={() => void registration.runStep()}
          onPickPicture={registration.pickPicture}
          onSkipUpload={registration.dismiss}
          onDismiss={registration.dismiss}
        />
      )}

      <AgentSection
        heading='Global Agents'
        agents={globalAgents}
        emptyText='No global agents.'
        showRegistration
        showOrgLabels={showOrgLabels}
        orgNamesById={orgNamesById}
        renderActions={agent => (
          <>
            {registerMenu(agent)}
            {iconAction(
              'Demote',
              <UserArrowDown className='size-4' />,
              () => demote.mutate(agent.slug),
              { showLabel: true },
            )}
            {isRegistered(agent) &&
              iconAction('Upload photo', <PhotoImagePlus className='size-4' />, () =>
                registration.pickPictureFor(agent.slug),
              )}
            {iconAction(
              'Delete agent',
              <DeleteDustbin01 className='size-4' />,
              () => setDeleteTarget(agent),
              { danger: true },
            )}
          </>
        )}
      />

      <AgentSection
        heading='Personal Agents'
        agents={personalAgents}
        emptyText='No personal agents.'
        showRegistration={false}
        showOrgLabels={showOrgLabels}
        orgNamesById={orgNamesById}
        renderActions={agent => (
          <>
            {registerMenu(agent)}
            {iconAction(
              'Promote',
              <UserArrowUp className='size-4' />,
              () => promote.mutate(agent.slug),
              { showLabel: true },
            )}
            {isRegistered(agent) &&
              iconAction('Upload photo', <PhotoImagePlus className='size-4' />, () =>
                registration.pickPictureFor(agent.slug),
              )}
            {iconAction(
              'Delete agent',
              <DeleteDustbin01 className='size-4' />,
              () => setDeleteTarget(agent),
              { danger: true },
            )}
          </>
        )}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null);
        }}
        title='Delete agent?'
        description={
          deleteTarget
            ? `${deleteTarget.name} will be removed for everyone. This cannot be undone.`
            : undefined
        }
        confirmLabel='Delete'
        danger
        loading={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.slug);
        }}
      />
    </div>
  );
}
