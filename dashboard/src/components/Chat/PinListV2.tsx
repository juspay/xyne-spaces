import React, { useContext } from 'react';
import { queries } from '../../zero/queries';
import { ChatBubble } from './ChatBubble/ChatBubble';
import { useNavigate } from 'react-router-dom';
import { ConversationTabContext } from './ConversationTabContext';
import { useRouteContext } from '../../hooks/useRouteContext';
import { useCachedQuery } from '../../hooks/useCachedQuery';

interface PinListProps {
  channelId: string;
}

const PinListV2: React.FC<PinListProps> = ({ channelId }) => {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const { setActiveTab } = useContext(ConversationTabContext);

  const [pinned] = useCachedQuery(queries.getPinnedMessegesV2({ channelId: channelId }));

  if (pinned.length === 0) {
    return (
      <div className='text-center text-muted-foreground py-8 bg-background flex items-center justify-center flex-1'>
        No pinned messages yet.
      </div>
    );
  }

  const handleOpenOriginalMessage = (convId: string): void => {
    setActiveTab?.('chat');
    window.location.hash = '';
    window.location.hash = `origin=${convId}`;

    void navigate(`${baseRoute}/${channelId}#origin=${convId}`, {
      replace: false,
    });
  };

  return (
    <div className='overflow-auto no-scrollbar p-6'>
      {/* Header */}
      <div className='pb-4'>
        <h2 className='text-lg font-semibold text-foreground'>Pinned messages</h2>
        <p className='text-sm text-muted-foreground'>Important messages saved for later</p>
      </div>

      {/* List */}
      <div className='space-y-4'>
        {pinned.map(conv => {
          const msg = conv.initialMessage;

          if (msg === undefined) return null;

          return (
            <div key={conv.conversationId}>
              <button
                onClick={() => handleOpenOriginalMessage(conv.conversationId)}
                className='w-full text-left block rounded-xl hover:bg-muted transition'
                data-track-category='CHAT_PINNED'
                data-track-name='Open_Pinned_Message'
                data-track-metadata={JSON.stringify({ conversationId: conv.conversationId })}
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

export default PinListV2;
