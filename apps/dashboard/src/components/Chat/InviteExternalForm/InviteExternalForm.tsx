import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import Button from '../../ui/Button';
import {
  connectRequestService,
  type ConnectRequestDto,
} from '../../../services/Chat/connectRequestService';

interface InviteExternalFormProps {
  channelId: string;
}

const STATUS_LABEL: Record<string, string> = {
  AWAITING_HOST_ADMIN: 'Awaiting your admin',
  AWAITING_GUEST: 'Sent — awaiting acceptance',
  AWAITING_GUEST_ADMIN: 'Awaiting guest admin',
  ACTIVE: 'Connected',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

/**
 * Slack-Connect: invite an external user (by email) to this connect channel, and show this channel's
 * pending invites. Only rendered for the channel creator / a workspace admin (gated in Info.tsx).
 */
export const InviteExternalForm: React.FC<InviteExternalFormProps> = ({ channelId }) => {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<ConnectRequestDto[]>([]);

  const refresh = useCallback(() => {
    void connectRequestService
      .listForChannel(channelId)
      .then(setRequests)
      .catch(() => {
        /* non-fatal: list may be empty / not permitted */
      });
  }, [channelId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleInvite = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    setSubmitting(true);
    try {
      await connectRequestService.invite(channelId, value);
      toast.success('Invitation sent for approval');
      setEmail('');
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send invitation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className='flex flex-col gap-4 p-4'>
      <div className='flex flex-col gap-1'>
        <p className='text-[15px] font-semibold text-foreground'>Invite external people</p>
        <p className='text-[13px] leading-[140%] text-muted-foreground'>
          Invite someone from another organization by email. It goes to your workspace admin, then
          to the invitee, then to their admin — once approved, they join this channel.
        </p>
      </div>

      <form onSubmit={e => void handleInvite(e)} className='flex items-center gap-2'>
        <input
          type='email'
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder='name@other-org.com'
          data-track-category='CONNECT_CHANNEL'
          data-track-name='invite_external_email_input'
          className='flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary'
        />
        <Button
          type='submit'
          disabled={submitting || !email.trim()}
          data-track-category='CONNECT_CHANNEL'
          data-track-name='invite_external_submit'
        >
          {submitting ? 'Inviting…' : 'Invite'}
        </Button>
      </form>

      <div className='flex flex-col gap-2'>
        <p className='text-[13px] font-medium text-muted-foreground'>
          Pending &amp; recent invites
        </p>
        {requests.length === 0 ? (
          <p className='text-[13px] text-muted-foreground italic'>No invitations yet.</p>
        ) : (
          <div className='flex flex-col gap-1'>
            {requests.map(r => (
              <div
                key={r.id}
                className='flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2'
              >
                <span className='truncate text-sm text-foreground'>{r.inviteEmail}</span>
                <span className='shrink-0 text-xs text-muted-foreground'>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default InviteExternalForm;
