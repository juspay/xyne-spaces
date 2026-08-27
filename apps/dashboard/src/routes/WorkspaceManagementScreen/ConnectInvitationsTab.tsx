import { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Inbox,
  UserCheck,
  UserX,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { WorkspaceRole } from '@xyne/shared';
import { Button } from '../../components/ui/Button/Button';
import { useSelf } from '../../hooks/useUsers';
import { cn } from '../../utils/classNames';
import {
  connectRequestService,
  type ConnectRequestDto,
} from '../../services/Chat/connectRequestService';

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

type ConnectView = 'outgoing' | 'incoming';

interface ConnectInvitationsTabProps {
  isActive?: boolean;
}

const formatDate = (value: string): string =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const formatStatus = (status: string): string =>
  status
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const ConnectInvitationsTab = ({
  isActive = false,
}: ConnectInvitationsTabProps): ReactElement => {
  const self = useSelf();
  const isAdmin = self?.role === WorkspaceRole.ADMIN || self?.role === WorkspaceRole.OWNER;

  const [view, setView] = useState<ConnectView>('outgoing');
  const [requests, setRequests] = useState<ConnectRequestDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});

  const loadRequests = useCallback(async (): Promise<void> => {
    if (!isAdmin) return;
    setIsLoading(true);
    try {
      const list =
        view === 'outgoing'
          ? await connectRequestService.outbox()
          : await connectRequestService.inbox();
      setRequests(list);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load connect invitations';
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, view]);

  useEffect(() => {
    if (isActive) void loadRequests();
  }, [isActive, loadRequests]);

  const handleApprove = async (request: ConnectRequestDto): Promise<void> => {
    setReviewingId(request.id);
    try {
      if (view === 'outgoing') {
        const { inviteLink } = await connectRequestService.hostApprove(request.id);
        if (inviteLink) {
          setInviteLinks(current => ({ ...current, [request.id]: inviteLink }));
          toast.success('Approved — invite link generated');
        } else {
          toast.success(`Approved ${request.inviteEmail}`);
        }
      } else {
        await connectRequestService.guestApprove(request.id);
        toast.success(`Approved ${request.inviteEmail}`);
      }
      await loadRequests();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve invitation';
      toast.error(message);
    } finally {
      setReviewingId(null);
    }
  };

  const handleReject = async (request: ConnectRequestDto): Promise<void> => {
    setReviewingId(request.id);
    try {
      await connectRequestService.reject(request.id);
      toast.success(`Rejected ${request.inviteEmail}`);
      await loadRequests();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reject invitation';
      toast.error(message);
    } finally {
      setReviewingId(null);
    }
  };

  const handleCopyLink = async (link: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Invite link copied to clipboard');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  if (!isAdmin) {
    return (
      <div className='space-y-6'>
        <Card className='p-8 text-center text-muted-foreground'>
          <Link2 className='mx-auto mb-3 h-12 w-12 opacity-50' />
          <p className='font-medium text-foreground'>Admins only</p>
          <p className='mt-1 text-sm'>
            You need to be a workspace admin to manage connect channel invitations.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10'>
          <Link2 className='h-5 w-5 text-primary' />
        </div>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Connect channel invitations</h2>
          <p className='text-sm text-muted-foreground'>
            Review cross-workspace shared channel requests
          </p>
        </div>
      </div>

      {/* Segmented toggle */}
      <div className='flex items-center justify-between gap-3'>
        <div className='inline-flex rounded-lg border border-border bg-muted p-1'>
          <button
            type='button'
            onClick={() => setView('outgoing')}
            data-track-category='CONNECT_CHANNEL'
            data-track-name='connect_invitations_view_outgoing'
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              view === 'outgoing'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Send className='h-4 w-4' />
            Outgoing
          </button>
          <button
            type='button'
            onClick={() => setView('incoming')}
            data-track-category='CONNECT_CHANNEL'
            data-track-name='connect_invitations_view_incoming'
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              view === 'incoming'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Inbox className='h-4 w-4' />
            Incoming
          </button>
        </div>
        <Button variant='outline' size='sm' onClick={() => void loadRequests()} loading={isLoading}>
          <RefreshCw className='h-4 w-4' />
          Refresh
        </Button>
      </div>

      {/* List */}
      <Card>
        <div className='border-b border-border p-4'>
          <h3 className='text-sm font-medium text-foreground'>
            {view === 'outgoing'
              ? 'Requests your workspace sent (host approval)'
              : 'Requests to join from other workspaces (guest approval)'}
          </h3>
        </div>

        {isLoading ? (
          <div className='flex items-center justify-center p-10 text-muted-foreground'>
            <Loader2 className='mr-2 h-5 w-5 animate-spin' />
            Loading invitations
          </div>
        ) : requests.length === 0 ? (
          <div className='p-10 text-center text-muted-foreground'>
            <CheckCircle2 className='mx-auto mb-3 h-12 w-12 opacity-50' />
            <p>No connect invitations</p>
            <p className='mt-1 text-sm'>
              {view === 'outgoing'
                ? 'Invitations awaiting your approval will appear here.'
                : 'Incoming connect requests will appear here.'}
            </p>
          </div>
        ) : (
          <div className='divide-y divide-border'>
            {requests.map(request => {
              const isReviewing = reviewingId === request.id;
              const inviteLink = inviteLinks[request.id];

              return (
                <div key={request.id} className='p-4'>
                  <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                    <div className='min-w-0'>
                      <div className='flex items-center gap-3'>
                        <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted'>
                          <Mail className='h-5 w-5 text-muted-foreground' />
                        </div>
                        <div className='min-w-0'>
                          <p className='truncate font-medium text-foreground'>
                            {request.inviteEmail}
                          </p>
                          <div className='flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
                            <span className='capitalize'>{request.entityType.toLowerCase()}</span>
                            <span>•</span>
                            <span>{formatStatus(request.status)}</span>
                            {view === 'incoming' && request.guestWorkspaceId && (
                              <>
                                <span>•</span>
                                <span className='truncate'>Guest: {request.guestWorkspaceId}</span>
                              </>
                            )}
                            <span>•</span>
                            <span>Sent {formatDate(request.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      {inviteLink && (
                        <div className='mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/50 p-2'>
                          <Link2 className='h-4 w-4 shrink-0 text-muted-foreground' />
                          <code className='min-w-0 flex-1 truncate text-xs text-foreground'>
                            {inviteLink}
                          </code>
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => void handleCopyLink(inviteLink)}
                          >
                            <Copy className='h-4 w-4' />
                            Copy
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className='flex shrink-0 justify-end gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={isReviewing}
                        onClick={() => void handleReject(request)}
                        className='text-destructive hover:bg-destructive/10 hover:text-destructive'
                      >
                        <UserX className='h-4 w-4' />
                        Reject
                      </Button>
                      <Button
                        size='sm'
                        loading={isReviewing}
                        onClick={() => void handleApprove(request)}
                      >
                        {view === 'outgoing' ? (
                          <Check className='h-4 w-4' />
                        ) : (
                          <UserCheck className='h-4 w-4' />
                        )}
                        Approve
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default ConnectInvitationsTab;
