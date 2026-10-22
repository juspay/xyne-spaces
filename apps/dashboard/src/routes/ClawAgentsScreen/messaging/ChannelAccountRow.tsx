import { ReactElement } from 'react';
import { Badge } from '@/components/ui/Badge';
import type { ChannelAccountView } from '@/services/claw/clawMessagingTypes';
import { CHANNEL_NAMES, connStateLabel } from './messagingChannels';

/** One channel account: which channel, the number/bot it answers on, and whether it is live. */
export const ChannelAccountRow = ({
  account,
  showAgent = false,
}: {
  account: ChannelAccountView;
  showAgent?: boolean;
}): ReactElement => {
  const connected = account.connState === 'connected';
  const detail = [
    account.displayId ?? 'Not linked yet',
    showAgent ? `default agent ${account.agent ? `/${account.agent.slug}` : 'none'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      data-testid={`claw-settings-channel-account-${account.id}`}
      className='flex items-center justify-between gap-3 py-1.5'
    >
      <div className='min-w-0'>
        <p className='truncate text-sm text-foreground'>{CHANNEL_NAMES[account.channel]}</p>
        <p className='truncate text-xs text-muted-foreground'>{detail}</p>
      </div>
      {connected ? (
        <Badge variant='success' className='gap-1'>
          <span className='size-1.5 rounded-full bg-white' />
          {connStateLabel(account.connState)}
        </Badge>
      ) : (
        <Badge variant='outline'>{connStateLabel(account.connState)}</Badge>
      )}
    </div>
  );
};
