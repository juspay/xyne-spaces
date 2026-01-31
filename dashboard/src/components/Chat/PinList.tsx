import React, { useContext } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';
import { ChatBubble } from './ChatBubble/ChatBubble';
import { useNavigate } from 'react-router-dom';
import { ConversationTabContext } from './ConversationTabContext';

interface PinListProps {
  chatMessages: QueryResultType<typeof queries.channelConversations> | undefined;
  channelId: string;
}

const PinList: React.FC<PinListProps> = ({ chatMessages, channelId }) => {
  const navigate = useNavigate();
  const { setActiveTab } = useContext(ConversationTabContext);

  const pinned = chatMessages?.filter(c => c.pinned) ?? [];

  if (pinned.length === 0) {
    return (
      <div className='text-center text-gray-500 py-8 bg-[#FFF] flex items-center justify-center flex-1'>
        No pinned messages yet.
      </div>
    );
  }

  const handleOpenOriginalMessage = (convId: string): void => {
    setActiveTab?.('chat');
    window.location.hash = '';
    window.location.hash = `origin=${convId}`;

    void navigate(`/chat/${channelId}#origin=${convId}`, {
      replace: false,
    });
  };

  return (
    <div className='overflow-auto no-scrollbar p-6'>
      {/* Header */}
      <div className='pb-4'>
        <h2 className='text-lg font-semibold text-gray-800'>Pinned messages</h2>
        <p className='text-sm text-gray-500'>Important messages saved for later</p>
      </div>

      {/* List */}
      <div className='space-y-4'>
        {pinned.map(conv => {
          const msg = conv.initialMessage as QueryResultType<
            typeof queries.conversationMessages
          >[number];

          return (
            <div key={conv.conversationId}>
              <button
                onClick={() => handleOpenOriginalMessage(conv.conversationId)}
                className='w-full text-left block rounded-xl hover:bg-gray-50 transition'
              >
                <ChatBubble
                  message={msg}
                  channelId={channelId}
                  showAvatar={true}
                  conversation={conv}
                  variant='pinned'
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PinList;
