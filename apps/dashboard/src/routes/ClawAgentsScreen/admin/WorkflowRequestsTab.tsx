import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckTickCircle, MultipleCrossCancelCircle } from '@xyne/icons';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  approveWorkflowGlobalRequest,
  listWorkflowGlobalRequests,
  rejectWorkflowGlobalRequest,
} from '@/services/claw/clawAdminService';
import type { AdminOrgScope, WorkflowGlobalRequest } from '@/services/claw/clawAdminTypes';
import { OrgBadge } from './components/AdminTable';
import { TabMessage } from './components/TabMessage';
import { workflowRequestsKey } from './hooks/adminQueryKeys';
import { orgLabel } from './orgLabel';

export function WorkflowRequestsTab({
  userId,
  scope,
  orgId,
  orgNamesById,
  showOrgLabels,
}: {
  userId: string;
  scope: AdminOrgScope;
  orgId: string | null;
  orgNamesById: Record<string, string>;
  showOrgLabels: boolean;
}): ReactElement {
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const {
    data: requests,
    isPending,
    isError,
  } = useQuery({
    queryKey: workflowRequestsKey(scope),
    queryFn: () => listWorkflowGlobalRequests(userId, scope),
    enabled: Boolean(userId),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: workflowRequestsKey(scope) });
  };

  const approve = useMutation({
    mutationFn: (requestId: string) => approveWorkflowGlobalRequest(userId, requestId),
    onSuccess: () => {
      toast.success('Workflow promoted to global');
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Approve failed')),
  });

  const reject = useMutation({
    mutationFn: ({ requestId, note }: { requestId: string; note?: string }) =>
      rejectWorkflowGlobalRequest(userId, requestId, note),
    onSuccess: () => {
      toast.success('Request rejected');
      setRejectingId(null);
      setRejectNote('');
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not reject the request')),
  });

  const busy = approve.isPending || reject.isPending;

  if (isPending) return <Skeleton className='mt-4 h-24 w-full' />;
  if (isError) return <TabMessage>Couldn’t load workflow requests.</TabMessage>;

  const visible = orgId ? (requests ?? []).filter(request => request.orgId === orgId) : requests;

  if (!visible || visible.length === 0) {
    return <TabMessage>No pending workflow promotion requests.</TabMessage>;
  }

  return (
    <div className='flex flex-col gap-3 pt-4'>
      {visible.map((request: WorkflowGlobalRequest) => {
        const who =
          request.requestedByUser?.name ??
          request.requestedByUser?.email ??
          request.requestedByUserId;
        const visibleOrgName = orgLabel(request.orgId, request.orgName, orgNamesById);
        return (
          <div key={request.id} className='rounded-xl border border-border px-4 py-3'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div className='min-w-0 flex-1'>
                <div className='flex min-w-0 flex-wrap items-center gap-2'>
                  <span className='truncate text-sm font-medium text-foreground'>
                    {request.workflow?.name ?? request.workflowId}
                  </span>
                  <Badge variant='secondary'>push to global</Badge>
                  {showOrgLabels && visibleOrgName && <OrgBadge orgName={visibleOrgName} />}
                </div>

                <p className='mt-1 text-xs text-muted-foreground'>
                  Requested by {who} · {new Date(request.createdAt).toLocaleString()}
                </p>

                {request.workflow?.description && (
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {request.workflow.description}
                  </p>
                )}
              </div>

              <div className='flex shrink-0 items-center gap-2'>
                <Button
                  type='button'
                  disabled={busy}
                  onClick={() => approve.mutate(request.id)}
                  data-track-category='Claw Admin'
                  data-track-name='Approve workflow request'
                >
                  <CheckTickCircle className='size-4' />
                  Allow
                </Button>
                <Button
                  type='button'
                  variant='destructive'
                  disabled={busy}
                  onClick={() => {
                    setRejectNote('');
                    setRejectingId(prev => (prev === request.id ? null : request.id));
                  }}
                  data-track-category='Claw Admin'
                  data-track-name='Reject workflow request'
                >
                  <MultipleCrossCancelCircle className='size-4' />
                  Reject
                </Button>
              </div>
            </div>

            {rejectingId === request.id && (
              <div className='mt-3 flex flex-wrap items-center gap-2'>
                <Input
                  value={rejectNote}
                  onChange={event => setRejectNote(event.target.value)}
                  placeholder='Reason (optional)'
                  className='min-w-0 flex-1'
                  aria-label='Rejection reason'
                />
                <Button
                  type='button'
                  variant='outline'
                  disabled={reject.isPending}
                  onClick={() =>
                    reject.mutate({
                      requestId: request.id,
                      ...(rejectNote.trim() ? { note: rejectNote.trim() } : {}),
                    })
                  }
                >
                  Confirm reject
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
