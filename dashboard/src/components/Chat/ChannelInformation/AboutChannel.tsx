import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button, ButtonType, ButtonSize } from '@juspay/blend-design-system';
import { useUser } from '../../../hooks/useUsers';
import { Channel } from '@xyne/shared';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';

interface AboutChannelProps {
  channel: Channel;
}

export const AboutChannel: React.FC<AboutChannelProps> = ({ channel }) => {
  const [copiedChannelId, setCopiedChannelId] = useState(false);
  const createdByUser = useUser(channel.createdBy);

  const channelParticipation = useGetChannelUserStatus(channel.id);
  const isAChannelParticipant = !!channelParticipation;

  const handleCopyChannelId = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(channel.id);
      void setCopiedChannelId(true);
      void setTimeout(() => setCopiedChannelId(false), 2000);
    } catch {
      /* empty */
    }
  };

  return (
    <div className='p-4 space-y-6'>
      {/* Description Section */}
      <div className='space-y-2 border-t border-gray-200 pt-6'>
        <div className='flex justify-between items-start'>
          <h3 className='text-sm font-medium text-gray-900'>Description</h3>
          <Button buttonType={ButtonType.SECONDARY} size={ButtonSize.SMALL} text='Edit' />
        </div>
        <p className='text-sm text-gray-600'>
          {channel.description || 'Click edit to add description'}
        </p>
      </div>

      {/* Created by Section */}
      <div className='space-y-2 border-t border-gray-200 pt-6'>
        <h3 className='text-sm font-medium text-gray-900'>Created by</h3>
        <p className='text-sm text-gray-600'>
          {createdByUser?.name || 'Unknown'} on{' '}
          {new Date(channel.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Leave Channel */}
      {isAChannelParticipant && (
        <div className='border-t border-gray-200 pt-6'>
          <Button buttonType={ButtonType.DANGER} size={ButtonSize.SMALL} text='Leave channel' />
        </div>
      )}

      {/* Channel ID */}
      <div className='border-t border-gray-200 pt-4'>
        <div className='flex items-center'>
          <span className='text-xs text-gray-500'>Channel ID: {channel.id}</span>
          <button
            onClick={() => void handleCopyChannelId()}
            className='p-1  text-gray-400 hover:text-gray-600 transition-colors'
            title='Copy Channel ID'
            data-track-category='CHANNEL_INFORMATION'
            data-track-name='COPY_CHANNEL_ID'
            data-track-metadata={JSON.stringify({ channelId: channel.id })}
          >
            {copiedChannelId ? (
              <Check className='w-3 h-3 text-green-500' />
            ) : (
              <Copy className='w-3 h-3' />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AboutChannel;
