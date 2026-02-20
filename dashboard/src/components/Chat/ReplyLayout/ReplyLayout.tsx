import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ThreadData } from '../ChatBubble/ChatBubble';
import { PencilIcon } from 'lucide-react';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import { formatRelativeTime } from '../../../utils/dateUtils';
import { ViewNewerRepliesButton } from '../../ui/MessageBubble/ThreadMessageIndicators';

const ReplyLayout: React.FC<{
  replies: ThreadData;
  draft?: string | undefined;
  isThreadOpen: boolean;
  isMe?: boolean;
  showInChannel?: boolean;
  showViewNewerReplies: boolean | undefined;
  parentConversationId?: string;
  messageId: string;
}> = ({
  replies,
  draft,
  isThreadOpen,
  isMe,
  showInChannel,
  showViewNewerReplies,
  parentConversationId,
  messageId,
}) => {
  const [hover, setHover] = useState(false);
  const { channelId } = useParams<{ channelId: string }>();

  // For showInChannel messages, show "View newer replies" only if there are newer replies in the parent thread
  // parentReplyCount is the current reply count in the original thread
  // replies.replyCount is the reply count at the time this message was shown in channel
  if (showInChannel && showViewNewerReplies && channelId && parentConversationId && messageId) {
    return (
      <ViewNewerRepliesButton
        channelId={channelId}
        parentConversationId={parentConversationId}
        messageId={messageId}
        isMe={isMe ?? false}
      />
    );
  }

  if (showInChannel) return null;

  if ((!replies || replies.replyCount === 0) && (!draft || isThreadOpen)) return null;

  const participants = replies.conversation?.participants || [];

  return (
    <div
      className={`flex items-center gap-2 mt-2 max-w-md pt-2 ${
        isMe
          ? 'min-[500px]:ml-14 max-[500px]:ml-auto max-[500px]:-mt-3'
          : 'min-[500px]:ml-14 max-[500px]:ml-12'
      } `}
    >
      <button
        onClick={replies.onOpenThread}
        className={`flex items-center gap-2 text-xs bg-transparent border-0 cursor-pointer transition-opacity duration-200 hover:opacity-80 flex-1 ${
          isMe ? 'max-[500px]:justify-end' : ''
        }`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {/* Participant Avatars */}
        {participants.length > 0 && (
          <AvatarGroup
            userIds={participants.map(participant => participant.userId)}
            size='sm'
            count={3}
          />
        )}
        {!replies || replies.replyCount === 0 ? (
          <div className='flex items-center gap-1 font-medium text-blue-600'>
            <PencilIcon size={10} />
            {'1 draft'}
          </div>
        ) : (
          <span className='font-medium text-blue-600'>
            {replies.replyCount} {replies.replyCount === 1 ? 'reply' : 'replies'}{' '}
            {draft && !isThreadOpen && ' and 1 draft'}
          </span>
        )}

        {replies.lastActivityAt && (
          <span className='relative inline-flex items-baseline text-gray-400 whitespace-nowrap w-[140px]'>
            <span
              className={`absolute left-0 top-0 ${isMe ? 'max-[500px]:right-0' : ''} transition-opacity duration-150 ${
                hover ? 'opacity-0' : 'opacity-100'
              }`}
            >
              Last activity {formatRelativeTime(replies.lastActivityAt)}
            </span>

            <span
              className={`absolute left-0 top-0 ${isMe ? 'max-[500px]:right-0' : ''} transition-opacity duration-150 ${
                hover ? 'opacity-100' : 'opacity-0'
              }`}
            >
              View thread
            </span>

            <span className='opacity-0 pointer-events-none'>
              Last activity {formatRelativeTime(replies.lastActivityAt)}
            </span>
          </span>
        )}
      </button>
    </div>
  );
};

export default ReplyLayout;
