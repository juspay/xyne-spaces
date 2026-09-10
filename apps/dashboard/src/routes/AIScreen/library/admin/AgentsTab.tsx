import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PluginAddonDefault,
  ChevronDown,
  DeleteDustbin01,
  MultipleCrossCancelCircle,
  PhotoImagePlus,
  Slack,
  UserArrowDown,
  UserArrowUp,
} from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Pill } from '../shared/primitives/Pill';
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
import type { SlackAgentStatus } from '@/services/claw/clawSlackTypes';
import type { AdminOrgScope } from '@/services/claw/clawAdminTypes';
import { OrgBadge } from './components/AdminTable';
import { TabMessage } from './components/TabMessage';
import { RegistrationFlowCard } from './components/RegistrationFlowCard';
import { adminAgentsKey, adminAgentsPrefix } from './hooks/adminQueryKeys';
import { useSlackActions } from './hooks/useSlackActions';
import { useSlackAgentStatuses } from './hooks/useSlackAgentStatuses';
import { SlackCommandDialog } from './components/SlackCommandDialog';
import { orgLabel } from './orgLabel';
import { AdminToolbarPortal } from './components/AdminToolbarSlot';
import { AdminSearchField } from './components/AdminSearchField';
import { HighlightMatch } from './components/HighlightMatch';
import { SurfaceLogo } from './components/SurfaceLogo';
import { PersonPill } from '../shared/primitives/PersonPill';
import type { AgentRegistration } from './hooks/useAgentRegistration';

const isRegistered = (agent: Agent): boolean =>
  Boolean(agent.spacesAppId) && (agent.spacesAppTokenConfigured ?? Boolean(agent.spacesAppToken));

const slackLabel = (status: SlackAgentStatus | undefined, ready: boolean): string => {
  if (!ready) return 'Slack (checking…)';
  if (!status) return 'Slack';
  if (status.status === 'installed') return 'Slack (add to another workspace)';
  if (status.status === 'command') return `Slack (${status.commandName ?? 'command'})`;
  return 'Slack (install to workspace)';
};

const slackBadgeLabel = (status: SlackAgentStatus): string => {
  if (status.status !== 'installed') return 'Slack: not installed';
  const teams = status.installs.map(install => install.teamName).filter(Boolean);
  return teams.length > 0 ? `Slack: ${teams.join(', ')}` : 'Slack: installed';
};

function AgentRow({
  agent,
  actions,
  query,
  showRegistration,
  showOrgLabels,
  orgNamesById,
  slackStatus,
}: {
  agent: Agent;
  actions: ReactElement;
  query: string;
  showRegistration: boolean;
  showOrgLabels: boolean;
  orgNamesById: Record<string, string>;
  slackStatus?: SlackAgentStatus | undefined;
}): ReactElement {
  const visibleOrgName = orgLabel(agent.orgId, agent.orgName, orgNamesById);
  const ownerLabel = agent.owner?.name ?? agent.owner?.email ?? 'Unknown owner';

  return (
    <li className='flex flex-col gap-1 border-b border-border px-1 py-4'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-sm font-medium text-foreground'>
            <HighlightMatch text={agent.name} query={query} />
          </span>
          {showOrgLabels && visibleOrgName && <OrgBadge orgName={visibleOrgName} />}
        </div>
        <div className='flex shrink-0 items-center gap-2'>{actions}</div>
      </div>

      {showRegistration ? (
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <Pill tone={isRegistered(agent) ? 'success' : 'neutral'}>
            {isRegistered(agent) ? 'Registered' : 'Not registered'}
          </Pill>
          {isRegistered(agent) && (
            <Tooltip content='Registered on Spaces' side='top'>
              <span className='inline-flex'>
                <SurfaceLogo surface='spaces' label='Spaces' />
              </span>
            </Tooltip>
          )}
          {slackStatus?.status === 'installed' && (
            <Tooltip content={slackBadgeLabel(slackStatus)} side='top'>
              <span className='inline-flex'>
                <SurfaceLogo surface='slack' label='Slack' />
              </span>
            </Tooltip>
          )}
          {slackStatus?.manifestStale && <Pill tone='warning'>Slack app update required</Pill>}
        </div>
      ) : (
        agent.ownerUserId && (
          <span className='flex min-w-0 items-center gap-1 text-xs text-muted-foreground'>
            owner:
            <PersonPill userId={agent.ownerUserId} name={ownerLabel} className='truncate' />
          </span>
        )
      )}
    </li>
  );
}

function AgentSection({
  heading,
  agents,
  emptyText,
  query,
  renderActions,
  showRegistration,
  showOrgLabels,
  orgNamesById,
  slackStatuses,
}: {
  heading: string;
  agents: Agent[];
  emptyText: string;
  query: string;
  renderActions: (agent: Agent) => ReactElement;
  showRegistration: boolean;
  showOrgLabels: boolean;
  orgNamesById: Record<string, string>;
  slackStatuses: Record<string, SlackAgentStatus>;
}): ReactElement {
  return (
    <section className='flex flex-col gap-3 pt-4'>
      <h3 className='text-base font-semibold text-foreground'>
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
              query={query}
              showRegistration={showRegistration}
              showOrgLabels={showOrgLabels}
              orgNamesById={orgNamesById}
              slackStatus={slackStatuses[agent.id]}
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
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [slackRemoveTarget, setSlackRemoveTarget] = useState<Agent | null>(null);

  const {
    data: agents,
    isPending,
    isError,
  } = useQuery({
    queryKey: adminAgentsKey(userId, scope),
    queryFn: () => listClawAuthAgents(userId, { allAgents: true, orgScope: scope }),
  });

  const visible = useMemo(() => {
    const scoped = orgId ? (agents ?? []).filter(agent => agent.orgId === orgId) : (agents ?? []);
    const needle = query.trim().toLowerCase();
    if (!needle) return scoped;
    return scoped.filter(agent =>
      `${agent.name} ${agent.slug} ${agent.owner?.name ?? ''} ${agent.owner?.email ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [agents, orgId, query]);

  const globalAgents = useMemo(() => visible.filter(agent => agent.scope === 'global'), [visible]);
  const personalAgents = useMemo(
    () => visible.filter(agent => agent.scope !== 'global'),
    [visible],
  );

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: adminAgentsPrefix(userId) });
  };

  const slack = useSlackAgentStatuses(userId, agents);
  const slackActions = useSlackActions(userId, slack.refresh);

  const onSlackConnect = (agent: Agent): void => {
    const status = slack.byAgentId[agent.id];
    if (status && status.status !== 'command') {
      slackActions.openInstall(agent);
      return;
    }
    slackActions.setChoice({ agent, commandName: status?.commandName ?? `/${agent.slug}` });
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

  const searchBar = (
    <AdminToolbarPortal>
      <AdminSearchField
        value={query}
        onChange={setQuery}
        placeholder='Search agents'
        ariaLabel='Search agents'
        trackName='Admin: search agents'
        className='w-full'
      />
    </AdminToolbarPortal>
  );

  if (isPending)
    return (
      <>
        {searchBar}
        <Skeleton className='mt-4 h-40 w-full' />
      </>
    );
  if (isError)
    return (
      <>
        {searchBar}
        <TabMessage>Couldn’t load agents.</TabMessage>
      </>
    );

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
            size='sm'
            disabled={busy}
            data-track-category='Claw Admin'
            data-track-name='Add surface'
            className='text-muted-foreground hover:text-foreground focus-visible:bg-muted focus-visible:ring-0'
          >
            <PluginAddonDefault className='size-4 text-current' />
            <span className='text-current'>
              {hasApp && !registered ? 'Resume setup' : 'Add surface'}
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
            <SurfaceLogo surface='spaces' label='' className='mr-2 size-4' />
            {hasApp && !registered ? 'Spaces (resume setup)' : 'Spaces'}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!slack.isReady || slackActions.busySlug === agent.slug}
            onSelect={() => onSlackConnect(agent)}
            className='data-[disabled]:pointer-events-auto data-[disabled]:cursor-not-allowed'
          >
            <SurfaceLogo surface='slack' label='' className='mr-2 size-4' />
            {slackLabel(slack.byAgentId[agent.id], slack.isReady)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-6 overflow-auto pb-6'>
      {searchBar}

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
        query={query}
        heading='Global Agents'
        agents={globalAgents}
        emptyText='No global agents.'
        showRegistration
        showOrgLabels={showOrgLabels}
        orgNamesById={orgNamesById}
        slackStatuses={slack.byAgentId}
        renderActions={agent => (
          <>
            {registerMenu(agent)}
            {iconAction(
              'Demote',
              <UserArrowDown className='size-4' />,
              () => demote.mutate(agent.slug),
              { showLabel: true },
            )}
            {slack.byAgentId[agent.id]?.manifestStale &&
              iconAction(
                'Update Slack app',
                <Slack className='size-4' />,
                () => slackActions.updateApp(agent),
                { disabled: slackActions.busySlug === agent.slug },
              )}
            {slack.byAgentId[agent.id] &&
              iconAction(
                'Remove Slack',
                <MultipleCrossCancelCircle className='size-4' />,
                () => setSlackRemoveTarget(agent),
                { disabled: slackActions.busySlug === agent.slug },
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
        query={query}
        heading='Personal Agents'
        agents={personalAgents}
        emptyText='No personal agents.'
        showRegistration={false}
        showOrgLabels={showOrgLabels}
        orgNamesById={orgNamesById}
        slackStatuses={slack.byAgentId}
        renderActions={agent => (
          <>
            {registerMenu(agent)}
            {iconAction(
              'Promote',
              <UserArrowUp className='size-4' />,
              () => promote.mutate(agent.slug),
              { showLabel: true },
            )}
            {slack.byAgentId[agent.id]?.manifestStale &&
              iconAction(
                'Update Slack app',
                <Slack className='size-4' />,
                () => slackActions.updateApp(agent),
                { disabled: slackActions.busySlug === agent.slug },
              )}
            {slack.byAgentId[agent.id] &&
              iconAction(
                'Remove Slack',
                <MultipleCrossCancelCircle className='size-4' />,
                () => setSlackRemoveTarget(agent),
                { disabled: slackActions.busySlug === agent.slug },
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

      <SlackCommandDialog
        choice={slackActions.choice}
        registering={slackActions.registering}
        busy={slackActions.busySlug !== null}
        onClose={() => slackActions.setChoice(null)}
        onRegisterCommand={slackActions.registerCommand}
        onCreateApp={() => {
          const agent = slackActions.choice?.agent;
          slackActions.setChoice(null);
          if (agent) slackActions.openInstall(agent);
        }}
      />

      <ConfirmDialog
        open={slackRemoveTarget !== null}
        onOpenChange={open => {
          if (!open) setSlackRemoveTarget(null);
        }}
        title='Remove Slack registration?'
        description={
          slackRemoveTarget
            ? `${slackRemoveTarget.name} will stop responding in Slack. If the Slack app still exists, delete it in the Slack console too.`
            : undefined
        }
        confirmLabel='Remove'
        danger
        loading={slackActions.busySlug === slackRemoveTarget?.slug}
        onConfirm={() => {
          if (slackRemoveTarget) slackActions.remove(slackRemoveTarget);
          setSlackRemoveTarget(null);
        }}
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
