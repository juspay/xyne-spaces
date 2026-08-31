import { ReactElement } from 'react';
import { Button, ButtonType, ButtonSize } from '@juspay/blend-design-system';
import { UserPlus } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import {
  posthogService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/posthogService';
import { v4 as uuidv4 } from 'uuid';

interface JoinChannelProps {
  channelId: string;
  channelTitle?: string;
}

/**
 * JoinChannel component displays a join button for public channels where the user is not a member
 * @param channelId - The ID of the channel to join
 * @param channelTitle - Optional title of the channel for display
 */
const JoinChannel = ({ channelId, channelTitle }: JoinChannelProps): ReactElement => {
  const zero = useZero();

  const handleJoinChannel = (): void => {
    zero.mutate(
      mutators.channel.joinChannel({
        channelId,
        channelParticipantId: uuidv4(),
        channelUserStatusId: uuidv4(),
        timestamp: Date.now(),
      }),
    );
    posthogService.capture(EVENTS.INITIATE_ACTION, {
      type: EVENT_PROPERTIES.ACTION_TYPES.JOIN_CHANNEL,
    });
  };

  return (
    <div
      data-id='join-channel'
      data-testid='join-channel'
      data-track-category='CHAT_INFO'
      data-track-name='JOIN_CHANNEL_VIEW'
      data-track-metadata={JSON.stringify({ channelId, channelTitle })}
      className='flex flex-col items-center justify-center p-8 bg-muted rounded-lg border border-border mx-4 mb-4'
    >
      <div className='text-center mb-6'>
        <h3 className='text-lg font-semibold text-foreground mb-2'>
          {channelTitle ? `Join #${channelTitle}` : 'Join Channel'}
        </h3>
        <p className='text-sm text-muted-foreground'>
          You&apos;re not a member of this channel yet. Join to start participating in
          conversations.
        </p>
      </div>

      <Button
        onClick={() => {
          void handleJoinChannel();
        }}
        leadingIcon={<UserPlus className='w-4 h-4' />}
        buttonType={ButtonType.PRIMARY}
        size={ButtonSize.MEDIUM}
        text='Join Channel'
        data-track-category='CHAT_INFO'
        data-track-name='JOIN_CHANNEL_BUTTON_CLICK'
        data-track-metadata={JSON.stringify({ channelId })}
      />
    </div>
  );
};

export default JoinChannel;
