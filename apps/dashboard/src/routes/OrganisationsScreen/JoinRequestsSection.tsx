import { ReactElement, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Mail, RefreshCw, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import {
  WorkspaceJoinRequestAction,
  type WorkspaceJoinRequestAction as WorkspaceJoinRequestActionType,
  WorkspaceJoinRequestStatus,
  type WorkspaceJoinRequestStatus as WorkspaceJoinRequestStatusType,
} from '@xyne/shared';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { apiInstance } from '../../services/clients/apiClient';
import { cn } from '../../utils/classNames';

const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): ReactElement => (
  <div className={cn('rounded-lg border border-border bg-card shadow-sm', className)}>
    {children}
  </div>
);

interface WorkspaceJoinRequest {
  id: string;
  workspaceId: string;
  email: string;
  status: WorkspaceJoinRequestStatusType;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceName?: string;
  workspaceType?: string | null;
}

interface JoinRequestsSectionProps {
  orgId: string;
}

const formatDate = (value: string): string =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const JoinRequestsSection = ({ orgId }: JoinRequestsSectionProps): ReactElement => {
  const [requests, setRequests] = useState<WorkspaceJoinRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const loadRequests = useCallback(async (): Promise<void> => {
    if (!orgId) return;

    setIsLoading(true);
    try {
      const response = await apiInstance.get<{ requests: WorkspaceJoinRequest[] }>(
        `/community/join-requests?orgId=${encodeURIComponent(orgId)}&status=${WorkspaceJoinRequestStatus.PENDING}`,
      );
      setRequests(response.data.requests || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load join requests';
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const reviewRequest = async (
    request: WorkspaceJoinRequest,
    action: WorkspaceJoinRequestActionType,
  ): Promise<void> => {
    const reviewNote = reviewNotes[request.id]?.trim();

    if (action === WorkspaceJoinRequestAction.REJECT && !reviewNote) {
      toast.error('Comment is required to reject a join request');
      return;
    }

    setReviewingRequestId(request.id);
    try {
      await apiInstance.post(
        `/community/${request.workspaceId}/join-requests/${request.id}/review`,
        {
          action,
          reviewNote: reviewNote || undefined,
        },
      );
      toast.success(
        action === WorkspaceJoinRequestAction.APPROVE
          ? `Approved ${request.email}`
          : `Rejected ${request.email}`,
      );
      setReviewNotes(current => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
      await loadRequests();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to review join request';
      toast.error(message);
    } finally {
      setReviewingRequestId(null);
    }
  };

  return (
    <Card>
      <div className='flex items-center justify-between gap-3 border-b border-border p-4'>
        <div className='flex items-center gap-3'>
          <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10'>
            <UserCheck className='h-5 w-5 text-primary' />
          </div>
          <div>
            <h2 className='text-sm font-medium text-foreground'>Workspace Join Requests</h2>
            <p className='mt-1 text-xs text-muted-foreground'>
              Organization admins approve access to request-based workspaces.
            </p>
          </div>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void loadRequests()}
          data-track-category='Organisations'
          data-track-name='RELOAD_JOIN_REQUESTS'
          loading={isLoading}
        >
          <RefreshCw className='h-4 w-4' />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className='flex items-center justify-center p-10 text-muted-foreground'>
          <Loader2 className='mr-2 h-5 w-5 animate-spin' />
          Loading requests
        </div>
      ) : requests.length === 0 ? (
        <div className='p-10 text-center text-muted-foreground'>
          <CheckCircle2 className='mx-auto mb-3 h-12 w-12 opacity-50' />
          <p>No pending join requests</p>
          <p className='mt-1 text-sm'>New workspace access requests will appear here.</p>
        </div>
      ) : (
        <div className='divide-y divide-border'>
          {requests.map(request => {
            const isReviewing = reviewingRequestId === request.id;
            const hasReviewNote = Boolean(reviewNotes[request.id]?.trim());

            return (
              <div key={request.id} className='p-4'>
                <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-3'>
                      <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted'>
                        <Mail className='h-5 w-5 text-muted-foreground' />
                      </div>
                      <div className='min-w-0'>
                        <p className='truncate font-medium text-foreground'>{request.email}</p>
                        <p className='text-sm text-muted-foreground'>
                          {request.workspaceName ? `${request.workspaceName} • ` : ''}
                          Requested {formatDate(request.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className='flex w-full flex-col gap-3 lg:w-[420px]'>
                    <Input
                      value={reviewNotes[request.id] || ''}
                      onChange={event =>
                        setReviewNotes(current => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))
                      }
                      placeholder='Comment (required for reject)'
                      disabled={isReviewing}
                    />
                    <div className='flex justify-end gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={isReviewing || !hasReviewNote}
                        onClick={() =>
                          void reviewRequest(request, WorkspaceJoinRequestAction.REJECT)
                        }
                        data-track-category='Organisations'
                        data-track-name='REJECT_JOIN_REQUEST'
                        className='text-destructive hover:bg-destructive/10 hover:text-destructive'
                      >
                        <UserX className='h-4 w-4' />
                        Reject
                      </Button>
                      <Button
                        size='sm'
                        loading={isReviewing}
                        onClick={() =>
                          void reviewRequest(request, WorkspaceJoinRequestAction.APPROVE)
                        }
                        data-track-category='Organisations'
                        data-track-name='APPROVE_JOIN_REQUEST'
                      >
                        <UserCheck className='h-4 w-4' />
                        Approve
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default JoinRequestsSection;
