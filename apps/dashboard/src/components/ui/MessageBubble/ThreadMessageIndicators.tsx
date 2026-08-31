import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChannelScopeType } from '@xyne/shared';
import { Button } from '../Button/Button';

interface ThreadInfoIndicatorProps {
  threadInfo: {
    conversationId: string;
    preview: string;
  };
  channelId: string;
  messageId: string;
}

/**
 * Displays a "replied to a thread" indicator with navigation to the parent thread
 */
export const ThreadInfoIndicator: React.FC<ThreadInfoIndicatorProps> = ({
  threadInfo,
  channelId,
  messageId,
}) => {
  const navigate = useNavigate();

  return (
    <div
      // CHANGED: max-w-[60%] enforces the 60% width limit
      className='cursor-pointer hover:underline inline-flex items-center gap-1 text-xs max-w-[60%]'
      onClick={() =>
        void navigate(
          `/chat/dir/${channelId}/${threadInfo.conversationId}/#origin=${threadInfo.conversationId}&messageId=${messageId}`,
        )
      }
      data-track-category='MESSAGE'
      data-track-name='OPEN_THREAD_FROM_INDICATOR'
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void navigate(`/chat/dir/${channelId}/${threadInfo.conversationId}`);
        }
      }}
      role='button'
      tabIndex={0}
    >
      <span className='text-primary whitespace-nowrap shrink-0'>replied to a thread:</span>

      <span className='text-primary font-medium truncate max-w-xs'>{threadInfo.preview}</span>
    </div>
  );
};

interface AlsoSentToChannelIndicatorProps {
  channelId: string;
  childConversationId: string;
  channelScopeType?: ChannelScopeType;
}

/**
 * Displays "Also sent to channel/DM" indicator in thread view
 */
export const AlsoSentToChannelIndicator: React.FC<AlsoSentToChannelIndicatorProps> = ({
  channelId,
  childConversationId,
  channelScopeType,
}) => {
  const navigate = useNavigate();

  return (
    <div className='flex justify-start'>
      <Button
        variant='ghost'
        onClick={() => {
          const messageLink = `/chat/dir/${channelId}#origin=${childConversationId}`;
          void navigate(messageLink);
        }}
        data-track-category='MESSAGE'
        data-track-name='COPY_THREAD_LINK'
        className='text-xs text-primary hover:text-primary/80 hover:underline mt-1 p-0 h-auto'
      >
        Also sent to{' '}
        {channelScopeType === ChannelScopeType.DM || channelScopeType === ChannelScopeType.GROUP_DM
          ? 'direct message'
          : 'channel'}
      </Button>
    </div>
  );
};

interface ViewNewerRepliesButtonProps {
  channelId: string;
  parentConversationId: string;
  messageId: string;
  isMe: boolean;
}

/**
 * Displays "View newer replies" button for navigating to parent thread
 */
export const ViewNewerRepliesButton: React.FC<ViewNewerRepliesButtonProps> = ({
  channelId,
  parentConversationId,
  messageId,
  isMe,
}) => {
  const navigate = useNavigate();

  const handleOpenParentThread = (): void => {
    void navigate(
      `/chat/dir/${channelId}/${parentConversationId}/#origin=${parentConversationId}&messageId=${messageId}`,
    );
  };

  return (
    <div
      className={`flex items-center gap-2 mt-2 max-w-md ${
        isMe
          ? 'min-[500px]:ml-14 max-[500px]:ml-auto max-[500px]:-mt-3'
          : 'min-[500px]:ml-14 max-[500px]:ml-12'
      } `}
    >
      <button
        onClick={handleOpenParentThread}
        data-track-category='MESSAGE'
        data-track-name='OPEN_PARENT_THREAD'
        className={`flex items-center gap-2 text-xs bg-transparent border-0 cursor-pointer transition-opacity duration-200 hover:opacity-80 flex-1 ${
          isMe ? 'max-[500px]:justify-end' : ''
        }`}
      >
        <span className='font-medium text-primary'>View newer replies</span>
      </button>
    </div>
  );
};
