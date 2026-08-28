import React, { useContext } from 'react';
import { queries } from '../../zero/queries';
import { ChatBubble } from './ChatBubble/ChatBubble';
import { useNavigate } from 'react-router-dom';
import { ConversationTabContext } from './ConversationTabContext';
import { useRouteContext } from '../../hooks/useRouteContext';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { DelayedSpinner } from '../ui/DelayedSpinner';
import { useGetChannelUserStatus } from '@xyne/shared/hooks';
import { DatePill } from './DatePill';
import { formatDatePill } from '../../utils/dateUtils';

interface PinListProps {
  channelId: string;
}

const PinListV2: React.FC<PinListProps> = ({ channelId }) => {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const { setActiveTab } = useContext(ConversationTabContext);

  const userChannelStatus = useGetChannelUserStatus(channelId);
  const [pinned, pinnedDetails] = useCachedQuery(
    queries.getPinnedMessegesV2({ channelId: channelId, isMember: !!userChannelStatus }),
  );

  // Query still in flight and nothing cached yet — show a loader, not the empty state.
  if (pinnedDetails.type !== 'complete' && pinned.length === 0) {
    return (
      <DelayedSpinner className='flex flex-1 items-center justify-center bg-background py-8' />
    );
  }

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

  // Newest pins first, so the date pills read Today → older down the list
  const sortedPins = pinned
    .filter(conv => conv.initialMessage !== undefined)
    .sort(
      (a, b) =>
        new Date(b.initialMessage!.createdAt).getTime() -
        new Date(a.initialMessage!.createdAt).getTime(),
    );

  return (
    // No horizontal padding — the bubble's own px-4 keeps pins aligned with channel messages
    <div className='overflow-auto no-scrollbar py-4 bg-background h-full'>
      {/* List */}
      <div className='space-y-8'>
        {sortedPins.map((conv, index) => {
          const msg = conv.initialMessage;

          if (msg === undefined) return null;

          const prevMsg = sortedPins[index - 1]?.initialMessage;
          const showDatePill =
            prevMsg === undefined ||
            new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

          return (
            <div key={conv.conversationId} className={showDatePill && index > 0 ? 'pt-6' : ''}>
              {showDatePill && <DatePill dateText={formatDatePill(msg.createdAt)} />}
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
