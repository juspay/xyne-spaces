import { useCallback, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Eye, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  approveAgentRequest,
  listPendingRequests,
  rejectAgentRequest,
} from '@/services/claw/clawAdminService';
import type { AdminOrgScope, AgentRequestItem } from '@/services/claw/clawAdminTypes';
import { OrgBadge } from './components/AdminTable';
import { TabMessage } from './components/TabMessage';
import { RegistrationFlowCard } from './components/RegistrationFlowCard';
import { adminAgentsKey, pendingRequestsKey } from './hooks/adminQueryKeys';
import type { AgentRegistration } from './hooks/useAgentRegistration';

const requestKindLabel = (request: AgentRequestItem): string =>
  request.requestType === 'push_to_global' ? 'Push to Global' : 'Push to Spaces';

const requestTitle = (request: AgentRequestItem): string =>
  request.targetType === 'skill'
    ? (request.skillName ?? request.skillSlug ?? 'Skill')
    : (request.agentName ?? request.agentSlug ?? 'Agent');

export function RequestsTab({
  userId,
  scope,
  showOrgLabels,
  registration,
}: {
  userId: string;
  scope: AdminOrgScope;
  showOrgLabels: boolean;
  registration: AgentRegistration;
}): ReactElement {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const {
    data: requests,
    isPending,
    isError,
  } = useQuery({
    queryKey: pendingRequestsKey(scope),
    queryFn: () => listPendingRequests(userId, scope),
  });

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: pendingRequestsKey(scope) });
    void queryClient.invalidateQueries({ queryKey: adminAgentsKey(userId, scope) });
  }, [queryClient, scope, userId]);

  const approveSkill = useMutation({
    mutationFn: (requestId: string) => approveAgentRequest(userId, requestId),
    onSuccess: () => {
      toast.success('Skill approved');
      refresh();
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
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Approval failed')),
  });

  const reject = useMutation({
    mutationFn: ({ requestId, note }: { requestId: string; note?: string }) =>
      rejectAgentRequest(userId, requestId, note),
    onSuccess: () => {
      toast.success('Request rejected');
      setRejectingId(null);
      setRejectNote('');
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not reject the request')),
  });

  const busy = approveSkill.isPending || approveAndSetup.isPending || reject.isPending;

  const content = isPending ? (
    <Skeleton className='h-24 w-full' />
  ) : isError ? (
    <TabMessage>Couldn’t load pending requests.</TabMessage>
  ) : !requests || requests.length === 0 ? (
    <TabMessage>No pending requests.</TabMessage>
  ) : (
    <ul className='flex flex-col gap-2'>
      {requests.map((request: AgentRequestItem) => (
        <li key={request.id} className='rounded-xl border border-border p-4'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0'>
              <div className='flex min-w-0 flex-wrap items-center gap-2'>
                <Badge variant='secondary'>
                  {request.targetType === 'skill' ? 'Skill' : 'Agent'}
                </Badge>
                <Badge variant='secondary'>{requestKindLabel(request)}</Badge>
                <span className='truncate text-sm font-medium text-foreground'>
                  {requestTitle(request)}
                </span>
                {showOrgLabels && request.orgName && <OrgBadge orgName={request.orgName} />}
              </div>

              <p className='mt-1 text-xs text-muted-foreground'>
                by {request.requesterName ?? request.requesterId}
                {request.requesterEmail ? ` (${request.requesterEmail})` : ''} ·{' '}
                {new Date(request.createdAt).toLocaleString()}
              </p>

              {request.agentOwnerName && (
                <p className='mt-0.5 text-xs text-muted-foreground'>
                  Agent created by: {request.agentOwnerName}
                  {request.agentOwnerEmail ? ` (${request.agentOwnerEmail})` : ''}
                </p>
              )}
            </div>

            <div className='flex shrink-0 items-center gap-2'>
              {request.targetType === 'agent' && request.agentSlug && (
                <Button
                  type='button'
                  variant='ghost'
                  disabled={busy}
                  onClick={() => {
                    void navigate(
                      `${workspaceId ? `/${workspaceId}` : ''}/claw-agents/agents/${request.agentSlug}`,
                    );
                  }}
                  data-track-category='Claw Admin'
                  data-track-name='View requested agent'
                >
                  <Eye className='size-4' />
                  View
                </Button>
              )}

              {request.targetType === 'skill' ? (
                <Button
                  type='button'
                  disabled={busy}
                  onClick={() => approveSkill.mutate(request.id)}
                  data-track-category='Claw Admin'
                  data-track-name='Approve skill request'
                >
                  <CheckCircle2 className='size-4' />
                  Approve
                </Button>
              ) : (
                <Button
                  type='button'
                  disabled={busy || !request.agentSlug}
                  onClick={() =>
                    approveAndSetup.mutate({
                      requestId: request.id,
                      slug: request.agentSlug as string,
                    })
                  }
                  data-track-category='Claw Admin'
                  data-track-name='Approve and setup agent request'
                >
                  <CheckCircle2 className='size-4' />
                  Approve &amp; Setup
                </Button>
              )}

              <Button
                type='button'
                variant='destructive'
                disabled={busy}
                onClick={() => {
                  setRejectNote('');
                  setRejectingId(prev => (prev === request.id ? null : request.id));
                }}
                data-track-category='Claw Admin'
                data-track-name='Reject request'
              >
                <XCircle className='size-4' />
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
        </li>
      ))}
    </ul>
  );

  return (
    <div className='flex flex-col gap-6'>
      {content}

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
    </div>
  );
}
