import { ReactElement } from 'react';
import { ConnectedChannelsCard } from './ConnectedChannelsCard';
import { LinkNumberCard } from './LinkNumberCard';
import { TeamsChannelCard } from './TeamsChannelCard';

/**
 * Settings → Messaging channels: the Xyne AI counterpart of the claw v3
 * "Your WhatsApp number" panel and messaging channels card. All data comes
 * from claw-auth's /api/v1/surfaces/:channel routes over the `/claw` proxy.
 */
export const MessagingChannelsSection = (): ReactElement => (
  <div className='space-y-3'>
    <LinkNumberCard />
    <ConnectedChannelsCard />
    <TeamsChannelCard />
  </div>
);
