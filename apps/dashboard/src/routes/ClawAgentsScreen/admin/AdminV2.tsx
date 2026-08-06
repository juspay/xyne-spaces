import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/Switch';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { useAuth } from '@/hooks/useAuth';
import { listClawAuthAgents } from '@/services/claw/clawAuthAgentsService';
import { listPendingRequests } from '@/services/claw/clawAdminService';
import type { AdminOrgScope } from '@/services/claw/clawAdminTypes';
import { AgentsTab } from './AgentsTab';
import { RequestsTab } from './RequestsTab';
import { adminAgentsKey, pendingRequestsKey } from './hooks/adminQueryKeys';
import { useAgentRegistration } from './hooks/useAgentRegistration';

const ADMIN_TABS = ['requests', 'agents'] as const;
type TabKey = (typeof ADMIN_TABS)[number];

const TAB_SCOPED_PARAMS = ['q', 'status'];

export default function AdminV2(): ReactElement {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const [allOrgs, setAllOrgs] = useState(false);
  const scope: AdminOrgScope = allOrgs ? 'all' : 'org';

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
    void queryClient.invalidateQueries({ queryKey: adminAgentsKey(userId, scope) });
  }, [queryClient, userId, scope]);

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

  const tabs = useMemo<TabItem[]>(
    () => [
      {
        id: 'requests',
        label: requests && requests.length > 0 ? `Requests (${requests.length})` : 'Requests',
      },
      { id: 'agents', label: agents ? `Agents (${agents.length})` : 'Agents' },
    ],
    [requests, agents],
  );

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col px-6 pb-16'>
      <div className='flex items-center gap-5 pt-5'>
        <div className='flex min-w-0 flex-1 flex-col justify-center gap-1'>
          <h1 className='text-2xl font-semibold tracking-tight text-foreground'>Admin Panel</h1>
          <p className='text-sm text-muted-foreground'>
            Manage requests, agents, admins, and platform settings
          </p>
        </div>
        <div className='flex shrink-0 items-center gap-2 text-xs text-muted-foreground'>
          <Switch checked={allOrgs} onCheckedChange={setAllOrgs} aria-label='Show all orgs' />
          <span>All orgs</span>
        </div>
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
          showOrgLabels={allOrgs}
          registration={registration}
        />
      )}
      {tab === 'agents' && (
        <AgentsTab
          userId={userId}
          scope={scope}
          showOrgLabels={allOrgs}
          registration={registration}
        />
      )}
    </div>
  );
}
