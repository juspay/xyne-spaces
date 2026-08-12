import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { useAuth } from '@/hooks/useAuth';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { queries } from '@/zero/queries';
import { listClawAuthAgents } from '@/services/claw/clawAuthAgentsService';
import {
  listMcpPublishRequests,
  listPendingRequests,
  listWorkflowGlobalRequests,
} from '@/services/claw/clawAdminService';
import { appsService } from '@/services/Apps/appsService';
import type { AdminOrgScope } from '@/services/claw/clawAdminTypes';
import { AgentsTab } from './AgentsTab';
import { AuditTab } from './AuditTab';
import { GlobalMcpTab } from './GlobalMcpTab';
import { RequestsTab } from './RequestsTab';
import { ScheduledTab } from './ScheduledTab';
import { UsageTab } from './UsageTab';
import {
  adminAgentsKey,
  adminAgentsPrefix,
  mcpPublishKey,
  pendingRequestsKey,
  workflowRequestsKey,
} from './hooks/adminQueryKeys';
import { useAgentRegistration } from './hooks/useAgentRegistration';
import { orgLabel } from './orgLabel';

const ADMIN_TABS = ['agents', 'requests', 'audit', 'usage', 'scheduled', 'global-mcp'] as const;
type TabKey = (typeof ADMIN_TABS)[number];

const TAB_SCOPED_PARAMS = ['q', 'status'];

const MY_ORG = 'mine';
const ALL_ORGS = 'all';

export default function AdminV2(): ReactElement {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [workspace] = useCachedQuery(
    queries.getWorkspaceById({ workspaceId: user?.workspaceId ?? '' }),
  );
  const myOrgId = workspace?.orgId ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const [orgFilter, setOrgFilter] = useState<string>(MY_ORG);
  const allOrgs = orgFilter !== MY_ORG;
  const scope: AdminOrgScope = allOrgs ? 'all' : 'org';
  const orgId = orgFilter === MY_ORG || orgFilter === ALL_ORGS ? null : orgFilter;

  const rawTab = searchParams.get('tab');
  const tab: TabKey = ADMIN_TABS.find(id => id === rawTab) ?? ADMIN_TABS[0];

  const setTab = (id: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    for (const param of TAB_SCOPED_PARAMS) next.delete(param);
    setSearchParams(next);
  };

  const queryClient = useQueryClient();
  const refreshAgents = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: adminAgentsPrefix(userId) });
  }, [queryClient, userId]);

  const registration = useAgentRegistration(refreshAgents);

  const { data: requests } = useQuery({
    queryKey: pendingRequestsKey(scope),
    queryFn: () => listPendingRequests(userId, scope),
    enabled: Boolean(userId),
  });

  const { data: agents } = useQuery({
    queryKey: adminAgentsKey(userId, scope),
    queryFn: () => listClawAuthAgents(userId, { allAgents: true, orgScope: scope }),
    enabled: Boolean(userId),
  });

  const { data: allOrgAgents } = useQuery({
    queryKey: adminAgentsKey(userId, 'all'),
    queryFn: () => listClawAuthAgents(userId, { allAgents: true, orgScope: 'all' }),
    enabled: Boolean(userId),
  });

  const { data: allOrgRequests } = useQuery({
    queryKey: pendingRequestsKey('all'),
    queryFn: () => listPendingRequests(userId, 'all'),
    enabled: Boolean(userId),
  });

  const optionAgents = useMemo(() => allOrgAgents ?? agents ?? [], [allOrgAgents, agents]);
  const optionRequests = useMemo(
    () => allOrgRequests ?? requests ?? [],
    [allOrgRequests, requests],
  );

  const orgIds = useMemo(
    () =>
      Array.from(
        new Set(
          [...optionAgents, ...optionRequests]
            .map(row => row.orgId)
            .filter((id): id is string => Boolean(id)),
        ),
      ).sort(),
    [optionAgents, optionRequests],
  );

  const { data: orgNamesById = {} } = useQuery({
    queryKey: ['claw-admin-org-names', orgIds],
    queryFn: () => appsService.getOrgNames(orgIds),
    enabled: orgIds.length > 0,
  });

  const orgOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of [...optionAgents, ...optionRequests]) {
      if (!row.orgId || row.orgId === myOrgId || seen.has(row.orgId)) continue;
      const label = orgLabel(row.orgId, row.orgName, orgNamesById);
      if (label) seen.set(row.orgId, label);
    }
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [optionAgents, optionRequests, myOrgId, orgNamesById]);

  const selectedOrgLabel =
    orgFilter === MY_ORG
      ? 'My org'
      : orgFilter === ALL_ORGS
        ? 'All orgs'
        : (orgOptions.find(option => option.value === orgFilter)?.label ?? 'Organization');

  const { data: mcpPublishRequests } = useQuery({
    queryKey: mcpPublishKey(),
    queryFn: () => listMcpPublishRequests(userId),
    enabled: Boolean(userId),
  });

  const { data: workflowRequests } = useQuery({
    queryKey: workflowRequestsKey(scope),
    queryFn: () => listWorkflowGlobalRequests(userId, scope),
    enabled: Boolean(userId),
  });

  const visibleRequestCount =
    (orgId
      ? (requests ?? []).filter(request => request.orgId === orgId).length
      : (requests?.length ?? 0)) +
    (mcpPublishRequests?.length ?? 0) +
    (orgId
      ? (workflowRequests ?? []).filter(request => request.orgId === orgId).length
      : (workflowRequests?.length ?? 0));

  const tabs = useMemo<TabItem[]>(
    () => [
      { id: 'agents', label: 'Agents' },
      {
        id: 'requests',
        label: visibleRequestCount > 0 ? `Requests (${visibleRequestCount})` : 'Requests',
      },
      { id: 'audit', label: 'Audit' },
      { id: 'usage', label: 'Usage' },
      { id: 'scheduled', label: 'Scheduled' },
      { id: 'global-mcp', label: 'Global MCP' },
    ],
    [visibleRequestCount],
  );

  return (
    <div className='max-w-ai-content mx-auto flex w-full flex-col px-6 pb-16'>
      <div className='sticky top-0 z-10 flex flex-col bg-background'>
        <div className='flex items-center gap-5 pt-5'>
          <div className='flex min-w-0 flex-1 flex-col justify-center gap-1'>
            <h1 className='text-2xl font-semibold leading-tight tracking-tight text-foreground'>
              Admin Panel
            </h1>
            <p className='text-sm leading-tight text-muted-foreground'>
              Manage requests, agents, admins, and platform settings
            </p>
          </div>
          <Select value={orgFilter} onValueChange={setOrgFilter}>
            <SelectTrigger
              className='w-48 shrink-0 focus-visible:border-ring focus-visible:ring-0'
              aria-label='Organization filter'
            >
              <SelectValue>{selectedOrgLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MY_ORG}>My org</SelectItem>
              <SelectItem value={ALL_ORGS}>All orgs</SelectItem>
              {orgOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='mt-3 flex flex-col gap-5 pb-3 pt-2'>
          <Tabs
            items={tabs}
            activeId={tab}
            onSelect={setTab}
            trackCategory='Claw Admin'
            trackPrefix='Admin tab'
          />
        </div>
      </div>

      <input
        type='file'
        accept='image/*'
        className='hidden'
        ref={registration.fileInputProps.ref}
        onChange={registration.fileInputProps.onChange}
      />

      {tab === 'requests' && (
        <RequestsTab
          userId={userId}
          scope={scope}
          orgId={orgId}
          orgNamesById={orgNamesById}
          showOrgLabels={orgFilter === ALL_ORGS}
          registration={registration}
        />
      )}
      {tab === 'agents' && (
        <AgentsTab
          userId={userId}
          scope={scope}
          orgId={orgId}
          orgNamesById={orgNamesById}
          showOrgLabels={orgFilter === ALL_ORGS}
          registration={registration}
        />
      )}
      {tab === 'global-mcp' && <GlobalMcpTab userId={userId} />}
      {tab === 'audit' && (
        <AuditTab
          userId={userId}
          scope={scope}
          orgId={orgId}
          orgNamesById={orgNamesById}
          showOrgLabels={orgFilter === ALL_ORGS}
        />
      )}
      {tab === 'usage' && (
        <UsageTab
          userId={userId}
          scope={scope}
          orgId={orgId}
          orgNamesById={orgNamesById}
          showOrgLabels={orgFilter === ALL_ORGS}
        />
      )}
      {tab === 'scheduled' && (
        <ScheduledTab
          userId={userId}
          scope={scope}
          orgId={orgId}
          orgNamesById={orgNamesById}
          showOrgLabels={orgFilter === ALL_ORGS}
        />
      )}
    </div>
  );
}
