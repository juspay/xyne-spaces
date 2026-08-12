import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckTickCircle, Eye02On, MultipleCrossCancelCircle } from '@xyne/icons';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
import type { AgentRegistration } from './hooks/useAgentRegistration';

type RequestKindTag = 'agent' | 'skill' | 'mcp' | 'workflow';

const KIND_LABEL: Record<RequestKindTag, string> = {
  agent: 'Agent',
  skill: 'Skill',
  mcp: 'MCP connector',
  workflow: 'Workflow',
};

const KIND_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'agent', label: 'Agent' },
  { value: 'skill', label: 'Skill' },
  { value: 'mcp', label: 'MCP connector' },
  { value: 'workflow', label: 'Workflow' },
];

interface UnifiedRequest {
  key: string;
  kind: RequestKindTag;
  title: string;
  meta: string;
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

const mcpOwner = (server: McpPublishRequest): string => {
  const owner = (server.connectorMeta ?? {})['ownerUserId'];
  return typeof owner === 'string' ? owner : (server.publishRequestedByUserId ?? 'unknown');
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
        meta: `by ${requester} · ${new Date(request.createdAt).toLocaleString()}`,
        extra: request.agentOwnerName ? `Agent created by: ${request.agentOwnerName}` : null,
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
        meta: `Owner: ${mcpOwner(server)}${
          at ? ` · Requested ${new Date(at).toLocaleString()}` : ''
        }`,
        extra: server.description ?? null,
        orgName: null,
        detail: (
          <details className='mt-3'>
            <summary className='cursor-pointer text-xs text-muted-foreground hover:text-foreground'>
              View connector definition
            </summary>
            <pre className='mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-muted/50 p-2 text-xs text-muted-foreground'>
              {connectorDefinition(server)}
            </pre>
          </details>
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
        meta: `Requested by ${who} · ${new Date(request.createdAt).toLocaleString()}`,
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

  const visible = kindFilter ? rows.filter(row => row.kind === kindFilter) : rows;

  const isPending = agentRequests.isPending || mcpRequests.isPending || workflowRequests.isPending;
  const isError = agentRequests.isError && mcpRequests.isError && workflowRequests.isError;
  const partialError =
    !isError && (agentRequests.isError || mcpRequests.isError || workflowRequests.isError);

  const filterBar = (
    <div className='flex flex-wrap items-center justify-end gap-2'>
      <FilterSelect
        ariaLabel='Request type filter'
        className='w-52'
        value={kindFilter}
        onChange={setKindFilter}
        options={KIND_OPTIONS}
      />
    </div>
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
        <li key={row.key} className='rounded-xl border border-border p-4'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='flex min-w-0 flex-col gap-1'>
              <div className='flex min-w-0 flex-wrap items-center gap-2'>
                <span className='truncate text-sm font-medium text-foreground'>{row.title}</span>
                <Badge variant='secondary'>{KIND_LABEL[row.kind]}</Badge>
                {showOrgLabels && row.orgName && <OrgBadge orgName={row.orgName} />}
              </div>

              <div className='flex flex-col gap-1'>
                <p className='text-xs text-muted-foreground'>{row.meta}</p>
                {row.extra && <p className='text-xs text-muted-foreground'>{row.extra}</p>}
              </div>
            </div>

            <div className='ml-auto flex shrink-0 items-center gap-2'>
              <Button
                type='button'
                size='sm'
                disabled={busy || row.approveDisabled}
                onClick={row.onApprove}
                data-track-category='Claw Admin'
                data-track-name={`Approve ${row.kind} request`}
              >
                <CheckTickCircle className='size-4' />
                {row.approveLabel}
              </Button>

              {row.onView && (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={busy}
                  onClick={row.onView}
                  data-track-category='Claw Admin'
                  data-track-name='View requested agent'
                >
                  <Eye02On className='size-4' />
                  View
                </Button>
              )}

              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={busy}
                onClick={() => {
                  setRejectNote('');
                  setRejectingKey(prev => (prev === row.key ? null : row.key));
                }}
                data-track-category='Claw Admin'
                data-track-name={`Reject ${row.kind} request`}
              >
                <MultipleCrossCancelCircle className='size-4' />
                Reject
              </Button>
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
              >
                Confirm reject
              </Button>
            </div>
          )}

          {row.detail}
        </li>
      ))}
    </ul>
  );

  return (
    <div className='flex flex-col gap-6 pt-4'>
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
