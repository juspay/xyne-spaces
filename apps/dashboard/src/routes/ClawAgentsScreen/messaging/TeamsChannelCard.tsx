/**
 * Microsoft Teams, kept apart from WhatsApp on purpose: it is a bot installed
 * into a tenant, not a phone number, so there is no "link my number" here.
 *
 * Rendered only when claw-auth runs the Teams channel. Until the Teams plugin
 * (XYNE-66904) is deployed with TEAMS_CHANNEL_ENABLED, /surfaces/teams/* is
 * "Unknown channel" (404) and this renders nothing.
 */
import { ReactElement } from 'react';
import { Users } from 'lucide-react';
import { useClawChannelAccess } from '@/hooks/useClawMessaging';
import { ChannelAccountRow } from './ChannelAccountRow';

export const TeamsChannelCard = (): ReactElement | null => {
  const teams = useClawChannelAccess('teams');

  // Hidden while we don't know yet, when it failed to load, and when the
  // deployment doesn't run Teams: an empty card would promise something absent.
  if (teams.isLoading) {
    return null;
  }
  if (teams.isError || !teams.data || teams.data.kind === 'unavailable') {
    return null;
  }
  const access = teams.data;

  return (
    <div
      data-testid='claw-settings-teams-channel'
      className='rounded-2xl border border-border bg-muted/30'
    >
      <div className='flex items-start gap-3 border-b border-border px-4 py-3'>
        <div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground'>
          <Users className='size-4' />
        </div>
        <div className='min-w-0'>
          <h3 className='text-sm font-semibold text-foreground'>Microsoft Teams</h3>
          <p className='text-xs text-muted-foreground'>
            Talk to your agents from Teams chats and channels.
          </p>
        </div>
      </div>

      <div className='px-4 py-3'>
        {access.kind === 'forbidden' ? (
          <p className='text-sm text-muted-foreground'>
            Teams is connected by your organization’s owners and admins.
          </p>
        ) : access.accounts.length === 0 ? (
          <p className='text-sm text-muted-foreground'>No Teams bot is connected yet.</p>
        ) : (
          <div className='divide-y divide-border'>
            {access.accounts.map(account => (
              <ChannelAccountRow key={account.id} account={account} showAgent />
            ))}
          </div>
        )}
        {/*
          TODO(XYNE-66905): tenant binding status and the caller's linked Teams
          account. claw-auth exposes neither yet — the Teams plugin has no
          self-service identity route (it has no senderIdFromPhone, so
          /my-numbers is 404) and tenant binding is being designed in 66905.
          Render both here once that ticket ships an endpoint; do not infer them
          from the account list.
        */}
      </div>
    </div>
  );
};
