import { ReactElement, useState, useMemo } from 'react';
import { MailPlus, Send, CheckCircle, UserPlus, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import { useSelf, useUsers } from '../../hooks/useUsers';
import { Invitation } from '@xyne/shared';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { API_BASE_URL } from '../../config';
import axios from 'axios';

interface ApiErrorResponse {
  error?: string;
  message?: string;
}

interface OrgMemberRow {
  memberId: string;
  orgId: string;
  email: string;
  role: string;
  joinedAt: number;
  leftAt?: number | null;
}

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

export const InvitationScreen = (): ReactElement => {
  const self = useSelf();
  const workspaceUsers = useUsers();
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null); // tracks which email is being submitted

  const workspaceId = self?.workspaceId ?? '';

  // Workspace → orgId
  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId }), {
    enabled: !!workspaceId,
  });
  const orgId = (workspace as { orgId?: string } | undefined)?.orgId ?? '';

  // Org members
  const [orgMembers] = useCachedQuery(queries.getOrgMembers({ orgId }), { enabled: !!orgId });

  // All invitations filtered by current workspace
  const [allInvitations] = useCachedQuery(queries.getAllInvitations({}));
  const invitations = useMemo(() => {
    if (!allInvitations) return [];
    return allInvitations.filter((inv: Invitation) => inv.workspaceId === workspaceId);
  }, [allInvitations, workspaceId]);

  // Org members who haven't joined the workspace yet and have no pending invite
  const uninvitedMembers = useMemo(() => {
    if (!orgMembers) return [];
    const now = Date.now();
    const workspaceEmails = new Set(workspaceUsers.map(u => u.email.toLowerCase()));
    const pendingInviteEmails = new Set(
      invitations
        .filter((inv: Invitation) => !inv.acceptedAt && (!inv.expiredAt || inv.expiredAt > now))
        .map((inv: Invitation) => inv.email.toLowerCase()),
    );
    return (orgMembers as OrgMemberRow[]).filter(
      m =>
        !workspaceEmails.has(m.email.toLowerCase()) &&
        !pendingInviteEmails.has(m.email.toLowerCase()),
    );
  }, [orgMembers, workspaceUsers, invitations]);

  const handleSendInvitation = async (email: string): Promise<void> => {
    if (!workspaceId || !orgId) {
      toast.error('No workspace or organisation selected');
      return;
    }

    setIsSubmitting(email);
    try {
      await axios.post(
        `${API_BASE_URL}/invitations`,
        { email, role: 'MEMBER', workspaceId, orgId },
        { withCredentials: true },
      );
      toast.success(`Invitation sent to ${email}`);
    } catch (error) {
      if (axios.isAxiosError<ApiErrorResponse>(error)) {
        const message =
          error.response?.data?.error ??
          error.response?.data?.message ??
          'Failed to send invitation';
        toast.error(message);
      } else {
        toast.error('Failed to send invitation');
      }
    } finally {
      setIsSubmitting(null);
    }
  };

  const handleRevokeInvitation = async (invitationId: string): Promise<void> => {
    try {
      await axios.delete(`${API_BASE_URL}/invitations/${invitationId}`, {
        withCredentials: true,
      });
      toast.success('Invitation revoked');
    } catch (error) {
      if (axios.isAxiosError<ApiErrorResponse>(error)) {
        const message = error.response?.data?.error ?? 'Failed to revoke invitation';
        toast.error(message);
      } else {
        toast.error('Failed to revoke invitation');
      }
    }
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const isInvitationRevocable = (invitation: Invitation): boolean => {
    if (invitation.acceptedAt) return false;
    if (!invitation.expiredAt) return true;
    const now = Date.now();
    const expiredAt = invitation.expiredAt;
    const createdAt = invitation.createdAt;
    if (expiredAt < now) return false;
    const fifteenDaysInMs = 15 * 24 * 60 * 60 * 1000;
    if (expiredAt - createdAt + 1000 < fifteenDaysInMs) return false;
    return true;
  };

  return (
    <div className='h-full bg-muted flex flex-col md:rounded-2xl overflow-hidden shadow-[0_0_8px_0_rgba(0,0,0,0.15)] border-root-border border'>
      <div className='flex-1 overflow-y-auto p-6'>
        <div className='max-w-4xl mx-auto space-y-6'>
          {/* Header */}
          <div className='flex items-center gap-3'>
            <MailPlus className='w-8 h-8 text-primary' />
            <div>
              <h1 className='text-2xl font-semibold text-foreground'>Invitations</h1>
              <p className='text-muted-foreground'>Invite org members to your workspace</p>
            </div>
          </div>

          {/* Org members to invite */}
          <Card className='p-6'>
            <div className='flex items-center gap-2 mb-4'>
              <UserPlus className='w-5 h-5 text-primary' />
              <h2 className='text-lg font-medium'>Pending Org Members</h2>
              <span className='text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full'>
                {uninvitedMembers.length} ready to invite
              </span>
            </div>

            {!orgId ? (
              <div className='text-center py-8 text-muted-foreground'>
                <p className='text-sm'>No organisation linked to this workspace</p>
                <p className='text-xs mt-1'>Go to Organisations to set one up</p>
              </div>
            ) : uninvitedMembers.length === 0 ? (
              <div className='text-center py-8 text-muted-foreground'>
                <UserPlus className='w-12 h-12 mx-auto mb-3 opacity-50' />
                <p>All org members have joined the workspace</p>
                <p className='text-sm mt-1'>
                  Add new members to the organisation first, then invite them here
                </p>
              </div>
            ) : (
              <div className='space-y-2'>
                {uninvitedMembers.map((member: OrgMemberRow) => (
                  <div
                    key={member.memberId}
                    className='flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors'
                  >
                    <div className='flex items-center gap-3'>
                      <div className='w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0'>
                        <span className='text-xs font-semibold text-primary'>
                          {member.email[0]?.toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className='text-sm font-medium text-foreground'>{member.email}</p>
                        <p className='text-xs text-muted-foreground capitalize'>
                          Org role: {member.role.toLowerCase()}
                        </p>
                      </div>
                    </div>
                    <Button
                      size='sm'
                      onClick={() => void handleSendInvitation(member.email)}
                      disabled={isSubmitting === member.email}
                      className='gap-2 bg-foreground text-background hover:bg-foreground/90'
                      data-track-category='Invitations'
                      data-track-name='SendInvitation'
                      data-track-metadata={JSON.stringify({ email: member.email })}
                    >
                      {isSubmitting === member.email ? (
                        <Loader2 className='w-4 h-4 animate-spin' />
                      ) : (
                        <Send className='w-4 h-4' />
                      )}
                      {isSubmitting === member.email ? 'Sending...' : 'Invite'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Pending Invitations list */}
          <Card className='p-6'>
            <h2 className='text-lg font-medium mb-4'>Pending Invitations</h2>

            {invitations.length === 0 ? (
              <div className='text-center py-8 text-muted-foreground'>
                <MailPlus className='w-12 h-12 mx-auto mb-3 opacity-50' />
                <p>No pending invitations</p>
                <p className='text-sm'>Invite org members to collaborate in your workspace</p>
              </div>
            ) : (
              <div className='space-y-3'>
                {invitations.map((invitation: Invitation) => (
                  <div
                    key={invitation.id}
                    className='flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors'
                  >
                    <div className='flex items-center gap-3'>
                      <div className='w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center'>
                        <MailPlus className='w-5 h-5 text-primary' />
                      </div>
                      <div>
                        <p className='font-medium text-foreground'>{invitation.email}</p>
                        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                          <span className='capitalize'>{invitation.role.toLowerCase()}</span>
                          <span>•</span>
                          <span>Sent {formatDate(invitation.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    {invitation.acceptedAt ? (
                      <span className='text-sm text-green-600 font-medium'>Accepted</span>
                    ) : isInvitationRevocable(invitation) ? (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => void handleRevokeInvitation(invitation.id)}
                        className='text-destructive hover:text-destructive hover:bg-destructive/10'
                        data-track-category='Invitations'
                        data-track-name='RevokeInvitation'
                        data-track-metadata={JSON.stringify({ invitationId: invitation.id })}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Info card */}
          <Card className='p-6 bg-muted/50 border-dashed'>
            <div className='flex items-start gap-3'>
              <CheckCircle className='w-5 h-5 text-primary mt-0.5' />
              <div>
                <h3 className='font-medium text-foreground'>How invitations work</h3>
                <ul className='mt-2 text-sm text-muted-foreground space-y-1 list-disc list-inside'>
                  <li>Add members to your organisation first via the Organisations screen</li>
                  <li>Then invite them to this workspace from the list above</li>
                  <li>They receive an email with a link to accept and set up their account</li>
                  <li>You can revoke invitations at any time before they are accepted</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default InvitationScreen;
