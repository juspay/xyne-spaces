import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Star, Users } from 'lucide-react';
import { Button, ButtonType, ButtonSize } from '@juspay/blend-design-system';
import { IconToggleButton, iconToggleVariants } from './IconToggleButton';
import { ChannelName } from '../ChannelName/ChannelName';
import ChannelInformation from '../ChannelInformation/ChannelInformation';
import { getTargetUserIdForCall } from '../ConversationHeader/ConversationHeader.utils';
import { CallTrigger } from '../../Call/CallTrigger/CallTrigger';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import { useZero } from '../../../hooks/useZero';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useChannel } from '../../../hooks/useChannels';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { ChannelScopeType } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';

interface ChatHeaderProps {
  channelId: string;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ channelId }) => {
  const context = useAuthContextValues();
  const zero = useZero();
  const navigate = useNavigate();
  const channel = useChannel(channelId);
  const channelUserStatus = useGetChannelUserStatus(channelId);
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, context.userID);
  const [showChannelInfoModal, setShowChannelInfoModal] = useState(false);
  const [modalDefaultTab, setModalDefaultTab] = useState<'about' | 'members'>('about');

  // Get target user ID for 1:1 DM calls
  const targetUserId = useMemo(
    () => getTargetUserIdForCall(channel?.scopeType, channel?.name, context.userID),
    [channel?.scopeType, channel?.name, context.userID],
  );

  // Handle star toggle
  const handleStarToggle = (): void => {
    void zero.mutate(mutators.channel.toggleStarred({ channelId }));
  };
  // Helper function to show participants count
  const shouldShowParticipants = (): boolean => {
    return Boolean(
      channel &&
      (channel.scopeType === ChannelScopeType.DEFAULT ||
        channel.scopeType === ChannelScopeType.GROUP_DM),
    );
  };

  // Handle back button click - navigate to chat route
  const handleBackClick = (): void => {
    void navigate('/chat');
  };

  // Handle channel name click - open modal in about tab
  const handleChannelNameClick = (): void => {
    setModalDefaultTab('about');
    setShowChannelInfoModal(true);
  };

  // Handle members button click - open modal in members tab
  const handleMembersClick = (): void => {
    setModalDefaultTab('members');
    setShowChannelInfoModal(true);
  };

  // Handle modal close
  const handleModalClose = (): void => {
    setShowChannelInfoModal(false);
  };

  return (
    <div className='bg-white'>
      {/* Top Header Section */}
      <div className='flex items-center justify-between px-4 py-3'>
        {/* Left Section - Channel Info */}
        <div className='flex items-center space-x-3'>
          <button
            onClick={handleBackClick}
            className='md:hidden'
            data-track-category='CHAT_HEADER'
            data-track-name='BACK_TO_DIRECTORY'
          >
            <ArrowLeft className='w-4 h-4' />
          </button>
          <IconToggleButton
            icon={Star}
            isActive={channelUserStatus?.isStarred ?? false}
            variants={iconToggleVariants.star}
            size='md'
            onToggle={handleStarToggle}
            aria-label='Toggle channel star'
          />
          {channel && (
            <ChannelName
              channel={channel}
              showIcon={true}
              iconSize='md'
              textSize='md'
              onClick={handleChannelNameClick}
              data-track-category='CHAT_HEADER'
              data-track-name='OPEN_CHANNEL_INFO'
              data-track-metadata={JSON.stringify({ channelId })}
            />
          )}
        </div>

        {/* Right Section - Action Buttons */}
        <div className='flex items-center space-x-2'>
          {/* Member Count - Only show for DEFAULT and GROUP_DM scope types */}
          {shouldShowParticipants() && (
            <Button
              buttonType={ButtonType.SECONDARY}
              size={ButtonSize.SMALL}
              text={channel?.participantCount?.toString() || '0'}
              leadingIcon={<Users className='w-4 h-4' />}
              onClick={handleMembersClick}
              data-track-category='CHAT_HEADER'
              data-track-name='OPEN_MEMBERS_LIST'
              data-track-metadata={JSON.stringify({ channelId })}
            />
          )}

          {/* Call Button */}
          <CallTrigger
            channelId={channelId}
            targetUserIds={targetUserId ? [targetUserId] : []}
            scopeType={channel?.scopeType}
            channelName={channel?.name}
            participantCount={channel?.participantCount}
            callDisplayName={channelDisplayName}
          />
        </div>
      </div>

      {/* Channel Information Modal */}
      {showChannelInfoModal && (
        <ChannelInformation
          channelId={channelId}
          modal={true}
          onClose={handleModalClose}
          defaultTab={modalDefaultTab}
          height='min-h-[400px] h-[66vh]'
        />
      )}
    </div>
  );
};

export default ChatHeader;
