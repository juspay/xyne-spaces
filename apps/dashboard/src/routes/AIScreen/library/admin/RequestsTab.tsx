import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  Bot,
  CheckTickCircle,
  Eye02On,
  FilterFunnel,
  GitBranch,
  LayerTwo,
  MultipleCrossCancelCircle,
  PluginAddonDefault,
} from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Tooltip from '@/components/ui/Tooltip';
import { Skeleton } from '@/components/ui/Skeleton';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  approveAgentRequest,
  approveServerPublish,
  approveWorkflowGlobalRequest,
  listMcpPublishRequests,
  listPendingRequests,
  listWorkflowGlobalRequests,
  rejectAgentRequest,
  rejectServerPublish,
  rejectWorkflowGlobalRequest,
} from '@/services/claw/clawAdminService';
import type {
  AdminOrgScope,
  AgentRequestItem,
  McpPublishRequest,
} from '@/services/claw/clawAdminTypes';
import { OrgBadge } from './components/AdminTable';
import { FilterSelect } from './components/FilterSelect';
import { TabMessage } from './components/TabMessage';
import { RegistrationFlowCard } from './components/RegistrationFlowCard';
import {
  adminAgentsPrefix,
  mcpPublishKey,
  pendingRequestsKey,
  pendingRequestsPrefix,
  workflowRequestsKey,
} from './hooks/adminQueryKeys';
import { orgLabel } from './orgLabel';
import { PersonPill } from '../shared/primitives/PersonPill';
import { AdminToolbarPortal } from './components/AdminToolbarSlot';
import { AdminSearchField } from './components/AdminSearchField';
import { HighlightMatch } from './components/HighlightMatch';
import type { AgentRegistration } from './hooks/useAgentRegistration';

type RequestKindTag = 'agent' | 'skill' | 'mcp' | 'workflow';

const KIND_OPTIONS = [
  { value: '', label: 'All types', icon: <FilterFunnel className='size-4' aria-hidden /> },
  { value: 'agent', label: 'Agent', icon: <Bot className='size-4' aria-hidden /> },
  { value: 'skill', label: 'Skill', icon: <LayerTwo className='size-4' aria-hidden /> },
  {
    value: 'mcp',
    label: 'MCP connector',
    icon: <PluginAddonDefault className='size-4' aria-hidden />,
  },
  { value: 'workflow', label: 'Workflow', icon: <GitBranch className='size-4' aria-hidden /> },
];

interface UnifiedRequest {
  key: string;
  kind: RequestKindTag;
  title: string;
  requesterId?: string | null;
  requesterName: string;
  occurredAt?: string | null;
  extra?: string | null;
  orgName?: string | null;
  detail?: ReactNode;
  approveLabel: string;
  approveDisabled?: boolean;
  onApprove: () => void;
  onReject: (note?: string) => void;
  onView?: (() => void) | undefined;
  rejectPlaceholder: string;
  sortAt: number;
}

const relativeTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDistanceToNow(date, { addSuffix: true });
};

const timestamp = (value: string | null | undefined): number => {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
};

const agentRequestTitle = (request: AgentRequestItem): string =>
  request.targetType === 'skill'
    ? (request.skillName ?? request.skillSlug ?? 'Skill')
    : (request.agentName ?? 'Agent');

const connectorDefinition = (server: McpPublishRequest): string =>
  JSON.stringify(
    {
      type: server.type,
      transport: server.transport,
      credentialForm: server.credentialForm,
      launchConfigTemplate: server.launchConfigTemplate,
      httpConfigTemplate: server.httpConfigTemplate,
      healthcheckSpec: server.healthcheckSpec,
      writeToolPolicy: server.writeToolPolicy,
    },
    null,
    2,
  );

const mcpOwnerId = (server: McpPublishRequest): string | null => {
  const owner = (server.connectorMeta ?? {})['ownerUserId'];
  if (typeof owner === 'string' && owner) return owner;
  return server.publishRequestedByUserId ?? null;
};

const mcpOwner = (server: McpPublishRequest): string => mcpOwnerId(server) ?? 'unknown';

const KIND_ICON: Record<RequestKindTag, ReactNode> = {
  agent: <Bot className='size-4' aria-hidden />,
  skill: <LayerTwo className='size-4' aria-hidden />,
  mcp: <PluginAddonDefault className='size-4' aria-hidden />,
  workflow: <GitBranch className='size-4' aria-hidden />,
};

const KIND_TOOLTIP: Record<RequestKindTag, string> = {
  agent: 'Agent request',
  skill: 'Skill request',
  mcp: 'MCP connector request',
  workflow: 'Workflow request',
};

const mcpRequestedAt = (server: McpPublishRequest): string | null => {
  const at = (server.connectorMeta ?? {})['publishRequestedAt'] ?? server.publishRequestedAt;
  return typeof at === 'string' ? at : null;
};

export function RequestsTab({
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
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
  const [rejectingKey, setRejectingKey] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [query, setQuery] = useState('');
  const [openDetailKey, setOpenDetailKey] = useState<string | null>(null);

  const agentRequests = useQuery({
    queryKey: pendingRequestsKey(scope),
    queryFn: () => listPendingRequests(userId, scope),
    enabled: Boolean(userId),
  });
  const mcpRequests = useQuery({
    queryKey: mcpPublishKey(),
    queryFn: () => listMcpPublishRequests(userId),
    enabled: Boolean(userId),
  });
  const workflowRequests = useQuery({
    queryKey: workflowRequestsKey(scope),
    queryFn: () => listWorkflowGlobalRequests(userId, scope),
    enabled: Boolean(userId),
  });

  const refreshAgents = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: pendingRequestsPrefix() });
    void queryClient.invalidateQueries({ queryKey: adminAgentsPrefix(userId) });
  }, [queryClient, userId]);
  const refreshMcp = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: mcpPublishKey() });
  }, [queryClient]);
  const refreshWorkflows = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: workflowRequestsKey(scope) });
  }, [queryClient, scope]);

  const closeReject = (): void => {
    setRejectingKey(null);
    setRejectNote('');
  };

  const approveSkill = useMutation({
    mutationFn: (requestId: string) => approveAgentRequest(userId, requestId),
    onSuccess: () => {
      toast.success('Skill approved');
      refreshAgents();
    },
    onError: error => toast.error(clawErrorText(error, 'Approve failed')),
  });

  const approveAndSetup = useMutation({
    mutationFn: async ({ requestId, slug }: { requestId: string; slug: string }) => {
      await approveAgentRequest(userId, requestId);
      await registration.startForSlug(userId, slug);
    },
    onSuccess: () => {
      toast.success('Request approved');
      refreshAgents();
    },
    onError: error => toast.error(clawErrorText(error, 'Approval failed')),
  });

  const rejectAgent = useMutation({
    mutationFn: ({ requestId, note }: { requestId: string; note?: string }) =>
      rejectAgentRequest(userId, requestId, note),
    onSuccess: () => {
      toast.success('Request rejected');
      closeReject();
      refreshAgents();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not reject the request')),
  });

  const approveMcp = useMutation({
    mutationFn: (serverId: string) => approveServerPublish(userId, serverId),
    onSuccess: () => {
      toast.success('Connector published');
      refreshMcp();
    },
    onError: error => toast.error(clawErrorText(error, 'Approve failed')),
  });

  const rejectMcp = useMutation({
    mutationFn: ({ serverId, note }: { serverId: string; note?: string }) =>
      rejectServerPublish(userId, serverId, note),
    onSuccess: () => {
      toast.success('Publish request rejected');
      closeReject();
      refreshMcp();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not reject the request')),
  });

  const approveWorkflow = useMutation({
    mutationFn: (requestId: string) => approveWorkflowGlobalRequest(userId, requestId),
    onSuccess: () => {
      toast.success('Workflow promoted to global');
      refreshWorkflows();
    },
    onError: error => toast.error(clawErrorText(error, 'Approve failed')),
  });

  const rejectWorkflow = useMutation({
    mutationFn: ({ requestId, note }: { requestId: string; note?: string }) =>
      rejectWorkflowGlobalRequest(userId, requestId, note),
    onSuccess: () => {
      toast.success('Request rejected');
      closeReject();
      refreshWorkflows();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not reject the request')),
  });

  const busy =
    approveSkill.isPending ||
    approveAndSetup.isPending ||
    rejectAgent.isPending ||
    approveMcp.isPending ||
    rejectMcp.isPending ||
    approveWorkflow.isPending ||
    rejectWorkflow.isPending;

  const { mutate: runApproveSkill } = approveSkill;
  const { mutate: runApproveAndSetup } = approveAndSetup;
  const { mutate: runRejectAgent } = rejectAgent;
  const { mutate: runApproveMcp } = approveMcp;
  const { mutate: runRejectMcp } = rejectMcp;
  const { mutate: runApproveWorkflow } = approveWorkflow;
  const { mutate: runRejectWorkflow } = rejectWorkflow;

  const rows = useMemo<UnifiedRequest[]>(() => {
    const all: UnifiedRequest[] = [];

    for (const request of agentRequests.data ?? []) {
      if (orgId && request.orgId !== orgId) continue;
      const isSkill = request.targetType === 'skill';
      const slug = request.agentSlug ?? null;
      const requester = request.requesterName ?? request.requesterEmail ?? 'Unknown requester';
      all.push({
        key: `agent-${request.id}`,
        kind: isSkill ? 'skill' : 'agent',
        title: agentRequestTitle(request),
        requesterId: request.requesterId,
        requesterName: requester,
        occurredAt: request.createdAt,
        orgName: orgLabel(request.orgId, request.orgName, orgNamesById),
        approveLabel: isSkill ? 'Approve' : 'Approve & Setup',
        approveDisabled: !isSkill && !slug,
        onApprove: () =>
          isSkill
            ? runApproveSkill(request.id)
            : runApproveAndSetup({ requestId: request.id, slug: slug as string }),
        onReject: note => runRejectAgent({ requestId: request.id, ...(note ? { note } : {}) }),
        onView:
          !isSkill && slug
            ? (): void => {
                void navigate(`${libraryPath}/agent/${encodeURIComponent(slug)}?tab=persona`, {
                  state: { returnTo: `${location.pathname}${location.search}${location.hash}` },
                });
              }
            : undefined,
        rejectPlaceholder: 'Reason (optional)',
        sortAt: timestamp(request.createdAt),
      });
    }

    for (const server of mcpRequests.data ?? []) {
      const at = mcpRequestedAt(server);
      all.push({
        key: `mcp-${server.id}`,
        kind: 'mcp',
        title: server.name,
        requesterId: mcpOwnerId(server),
        requesterName: mcpOwner(server),
        occurredAt: at,
        extra: null,
        orgName: null,
        detail: (
          <pre className='mt-3 max-h-72 overflow-auto rounded-lg border border-border bg-muted/50 p-2 text-xs text-muted-foreground'>
            {connectorDefinition(server)}
          </pre>
        ),
        approveLabel: 'Approve',
        onApprove: () => runApproveMcp(server.id),
        onReject: note => runRejectMcp({ serverId: server.id, ...(note ? { note } : {}) }),
        rejectPlaceholder: 'Reason for rejection (shown to the connector author)',
        sortAt: timestamp(at),
      });
    }

    for (const request of workflowRequests.data ?? []) {
      if (orgId && request.orgId !== orgId) continue;
      const who =
        request.requestedByUser?.name ??
        request.requestedByUser?.email ??
        request.requestedByUserId;
      all.push({
        key: `workflow-${request.id}`,
        kind: 'workflow',
        title: request.workflow?.name ?? request.workflowId,
        requesterId: request.requestedByUserId,
        requesterName: who,
        occurredAt: request.createdAt,
        extra: request.workflow?.description ?? null,
        orgName: orgLabel(request.orgId, request.orgName, orgNamesById),
        approveLabel: 'Allow',
        onApprove: () => runApproveWorkflow(request.id),
        onReject: note => runRejectWorkflow({ requestId: request.id, ...(note ? { note } : {}) }),
        rejectPlaceholder: 'Reason (optional)',
        sortAt: timestamp(request.createdAt),
      });
    }

    return all.sort((a, b) => b.sortAt - a.sortAt);
  }, [
    agentRequests.data,
    mcpRequests.data,
    workflowRequests.data,
    orgId,
    orgNamesById,
    libraryPath,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    runApproveSkill,
    runApproveAndSetup,
    runRejectAgent,
    runApproveMcp,
    runRejectMcp,
    runApproveWorkflow,
    runRejectWorkflow,
  ]);

  const byKind = kindFilter ? rows.filter(row => row.kind === kindFilter) : rows;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? byKind.filter(row => `${row.title} ${row.requesterName}`.toLowerCase().includes(needle))
    : byKind;

  const isPending = agentRequests.isPending || mcpRequests.isPending || workflowRequests.isPending;
  const isError = agentRequests.isError && mcpRequests.isError && workflowRequests.isError;
  const partialError =
    !isError && (agentRequests.isError || mcpRequests.isError || workflowRequests.isError);

  const filterBar = (
    <AdminToolbarPortal>
      <AdminSearchField
        value={query}
        onChange={setQuery}
        placeholder='Search requests'
        ariaLabel='Search requests'
        trackName='Admin: search requests'
        className='w-full'
      />
      <div className='flex flex-wrap items-center justify-end gap-2'>
        <FilterSelect
          ariaLabel='Request type filter'
          icon={<FilterFunnel className='size-4 shrink-0 text-muted-foreground' aria-hidden />}
          value={kindFilter}
          onChange={setKindFilter}
          options={KIND_OPTIONS}
        />
      </div>
    </AdminToolbarPortal>
  );

  const content = isPending ? (
    <Skeleton className='h-24 w-full' />
  ) : isError ? (
    <TabMessage>Couldn’t load pending requests.</TabMessage>
  ) : visible.length === 0 ? (
    <TabMessage>No pending requests.</TabMessage>
  ) : (
    <ul className='flex flex-col gap-2'>
      {visible.map(row => (
        <li key={row.key} className='rounded-xl border border-border px-4 py-3'>
          <div className='flex flex-col gap-1'>
            <div className='flex min-w-0 items-start gap-2'>
              <Tooltip content={KIND_TOOLTIP[row.kind]} side='top'>
                <span className='flex size-5 shrink-0 items-center justify-center text-muted-foreground'>
                  {KIND_ICON[row.kind]}
                </span>
              </Tooltip>

              <div className='flex min-w-0 flex-1 flex-col gap-2'>
                <div className='flex min-w-0 items-center gap-2'>
                  {row.onView ? (
                    <button
                      type='button'
                      onClick={row.onView}
                      className='truncate text-left text-sm font-medium text-foreground hover:underline'
                      data-track-category='Claw Admin'
                      data-track-name='Open requested item'
                    >
                      <HighlightMatch text={row.title} query={query} />
                    </button>
                  ) : (
                    <span className='truncate text-sm font-medium text-foreground'>
                      <HighlightMatch text={row.title} query={query} />
                    </span>
                  )}
                  {showOrgLabels && row.orgName && <OrgBadge orgName={row.orgName} />}
                </div>

                <p className='flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground'>
                  Requested by
                  <PersonPill userId={row.requesterId} name={row.requesterName} />
                  {row.occurredAt && (
                    <>
                      <span aria-hidden>·</span>
                      <Tooltip content={new Date(row.occurredAt).toLocaleString()} side='top'>
                        <span className='cursor-default'>{relativeTime(row.occurredAt)}</span>
                      </Tooltip>
                    </>
                  )}
                </p>

                {row.extra && <p className='text-xs text-muted-foreground'>{row.extra}</p>}
              </div>

              <div className='-my-1 flex shrink-0 items-center gap-1'>
                {row.detail ? (
                  <Tooltip content='View details' side='top'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label='View details'
                      aria-expanded={openDetailKey === row.key}
                      onClick={() => setOpenDetailKey(prev => (prev === row.key ? null : row.key))}
                      className='size-7 text-muted-foreground hover:text-foreground'
                      data-track-category='Claw Admin'
                      data-track-name='View request details'
                    >
                      <Eye02On className='size-4' />
                    </Button>
                  </Tooltip>
                ) : (
                  <span className='size-7' aria-hidden />
                )}

                <Tooltip content={row.approveLabel} side='top'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label={row.approveLabel}
                    disabled={busy || row.approveDisabled}
                    onClick={row.onApprove}
                    className='size-7 text-muted-foreground hover:bg-status-success/10 hover:text-status-success'
                    data-track-category='Claw Admin'
                    data-track-name={`Approve ${row.kind} request`}
                  >
                    <CheckTickCircle className='size-4' />
                  </Button>
                </Tooltip>

                <Tooltip content='Reject request' side='top'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label='Reject request'
                    disabled={busy}
                    onClick={() => {
                      setRejectNote('');
                      setRejectingKey(prev => (prev === row.key ? null : row.key));
                    }}
                    className='size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                    data-track-category='Claw Admin'
                    data-track-name={`Reject ${row.kind} request`}
                  >
                    <MultipleCrossCancelCircle className='size-4' />
                  </Button>
                </Tooltip>
              </div>
            </div>
          </div>

          {rejectingKey === row.key && (
            <div className='mt-3 flex flex-wrap items-center gap-2'>
              <Input
                value={rejectNote}
                onChange={event => setRejectNote(event.target.value)}
                placeholder={row.rejectPlaceholder}
                className='min-w-0 flex-1'
                aria-label='Rejection reason'
              />
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={busy}
                onClick={() => row.onReject(rejectNote.trim() || undefined)}
                data-track-category='Claw Admin'
                data-track-name='Confirm reject request'
              >
                Confirm reject
              </Button>
            </div>
          )}

          {openDetailKey === row.key && row.detail}
        </li>
      ))}
    </ul>
  );

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-6 overflow-auto'>
      {registration.flow && (
        <RegistrationFlowCard
          flow={registration.flow}
          onRun={() => void registration.runStep()}
          onPickPicture={registration.pickPicture}
          onSkipUpload={registration.dismiss}
          onDismiss={registration.dismiss}
          showUploadStep
        />
      )}

      {filterBar}

      {partialError && (
        <TabMessage>Some request types couldn’t be loaded. Showing what is available.</TabMessage>
      )}

      {content}
    </div>
  );
}
