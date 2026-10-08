import { ReactElement, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Mail, RefreshCw, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button/Button';
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

interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  workspaceName: string | null;
  invitedAt: string;
  createdAt: string;
  invitedByName: string | null;
  invitedByEmail: string | null;
  isOrgApproved: boolean;
  inviteEmailSentAt: string | null;
  /** Guest invites only: the channel/canvas/project the guest gets access to. */
  entityType: 'CHANNEL' | 'CANVAS' | 'PROJECT' | null;
  entityTitle: string | null;
}

// "Guest · #support" — so the approver sees what a guest invite grants.
const formatRole = (invitation: PendingInvitation): string => {
  if (!invitation.entityType) return invitation.role;
  const title = invitation.entityTitle ?? 'Untitled';
  const target = invitation.entityType === 'CHANNEL' ? `#${title}` : title;
  return `${invitation.role} · ${target}`;
};

interface PendingInvitationsSectionProps {
  orgId: string;
}

const formatDate = (value: string): string =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const PendingInvitationsSection = ({
  orgId,
}: PendingInvitationsSectionProps): ReactElement => {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const loadInvitations = useCallback(async (): Promise<void> => {
    if (!orgId) return;

    setIsLoading(true);
    try {
      const response = await apiInstance.get<{ invitations: PendingInvitation[] }>(
        `/invitations/pending-approvals`,
        { params: { orgId } },
      );
      setInvitations(response.data.invitations || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load pending invitations';
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  const reviewInvitation = async (
    invitation: PendingInvitation,
    action: 'approve' | 'reject',
  ): Promise<void> => {
    setReviewingId(invitation.id);
    try {
      await apiInstance.post(`/invitations/${invitation.id}/${action}`);
      const isResend = action === 'approve' && invitation.isOrgApproved;
      toast.success(
        action === 'reject'
          ? `Rejected ${invitation.email}`
          : isResend
            ? `Invite email resent to ${invitation.email}`
            : `Approved ${invitation.email} — invite emailed`,
      );
      await loadInvitations();
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to ${action} invitation`;
      toast.error(message);
    } finally {
      setReviewingId(null);
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
            <h2 className='text-sm font-medium text-foreground'>Pending Invitations</h2>
            <p className='mt-1 text-xs text-muted-foreground'>
              Invites to people outside the organisation, waiting for your approval.
            </p>
          </div>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void loadInvitations()}
          data-track-category='Organisations'
          data-track-name='RELOAD_PENDING_INVITATIONS'
          loading={isLoading}
        >
          <RefreshCw className='h-4 w-4' />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className='flex items-center justify-center p-10 text-muted-foreground'>
          <Loader2 className='mr-2 h-5 w-5 animate-spin' />
          Loading invitations
        </div>
      ) : invitations.length === 0 ? (
        <div className='p-10 text-center text-muted-foreground'>
          <CheckCircle2 className='mx-auto mb-3 h-12 w-12 opacity-50' />
          <p>No pending invitations</p>
          <p className='mt-1 text-sm'>
            Invites to people outside the organisation will appear here.
          </p>
        </div>
      ) : (
        <div className='divide-y divide-border'>
          {invitations.map(invitation => {
            const isReviewing = reviewingId === invitation.id;
            const isEmailFailed = invitation.isOrgApproved && !invitation.inviteEmailSentAt;

            return (
              <div key={invitation.id} className='p-4'>
                <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
                  <div className='flex min-w-0 items-center gap-3'>
                    <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted'>
                      <Mail className='h-5 w-5 text-muted-foreground' />
                    </div>
                    <div className='min-w-0'>
                      <p className='truncate font-medium text-foreground'>{invitation.email}</p>
                      <p className='text-sm text-muted-foreground'>
                        {invitation.workspaceName ? `${invitation.workspaceName} • ` : ''}
                        {formatRole(invitation)} • invited{' '}
                        {invitation.invitedByName
                          ? `by ${invitation.invitedByName}`
                          : formatDate(invitation.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className='flex items-center justify-end gap-2'>
                    <Clock className='h-4 w-4 text-muted-foreground' />
                    <span className='mr-2 text-xs text-muted-foreground'>
                      {formatDate(invitation.createdAt)}
                    </span>
                    {isEmailFailed && (
                      <span className='rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600'>
                        Email failed to send
                      </span>
                    )}
                    {isEmailFailed ? (
                      <Button
                        size='sm'
                        loading={isReviewing}
                        onClick={() => void reviewInvitation(invitation, 'approve')}
                        data-track-category='Organisations'
                        data-track-name='RESEND_INVITATION_EMAIL'
                      >
                        <RefreshCw className='h-4 w-4' />
                        Resend email
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={isReviewing}
                          onClick={() => void reviewInvitation(invitation, 'reject')}
                          data-track-category='Organisations'
                          data-track-name='REJECT_PENDING_INVITATION'
                          className='text-destructive hover:bg-destructive/10 hover:text-destructive'
                        >
                          <UserX className='h-4 w-4' />
                          Reject
                        </Button>
                        <Button
                          size='sm'
                          loading={isReviewing}
                          onClick={() => void reviewInvitation(invitation, 'approve')}
                          data-track-category='Organisations'
                          data-track-name='APPROVE_PENDING_INVITATION'
                        >
                          <UserCheck className='h-4 w-4' />
                          Approve
                        </Button>
                      </>
                    )}
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

export default PendingInvitationsSection;
