import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ThreadData } from '../ChatBubble/ChatBubble';
import { PencilIcon } from 'lucide-react';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import { formatRelativeTime } from '../../../utils/dateUtils';
import { ViewNewerRepliesButton } from '../../ui/MessageBubble/ThreadMessageIndicators';
import { ConversationParticipation } from '@xyne/shared';

const ReplyLayout: React.FC<{
  replies: ThreadData;
  draft?: string | undefined;
  hasDraftAttachments?: boolean;
  isThreadOpen: boolean;
  isMe?: boolean;
  showInChannel?: boolean;
  isCallMessage?: boolean;
  showViewNewerReplies: boolean | undefined;
  parentConversationId?: string;
  messageId: string;
}> = ({
  replies,
  draft,
  hasDraftAttachments,
  isThreadOpen,
  isMe,
  showInChannel,
  isCallMessage,
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

  // Call messages (e.g., headless recordings) use showInChannel: true for direct visibility
  // but still need to show their thread indicator for summaries/PRDs posted as replies
  if (showInChannel && !isCallMessage) return null;

  const hasDraft = draft || hasDraftAttachments;
  if ((!replies || replies.replyCount === 0) && (!hasDraft || isThreadOpen)) return null;

  const rawParticipants = replies.conversation?.participants;
  const participantsArray = Array.isArray(rawParticipants)
    ? rawParticipants
    : rawParticipants
      ? [rawParticipants]
      : [];
  const participants = participantsArray.filter(
    p => p.participationType === ConversationParticipation.AUTHOR,
  );

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
        data-track-category='MESSAGE'
        data-track-name='OPEN_THREAD_FROM_REPLY_LAYOUT'
        data-track-metadata={JSON.stringify({ replyCount: replies?.replyCount, messageId })}
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
          <div className='flex items-center gap-1 font-medium text-primary'>
            <PencilIcon size={10} />
            {'1 draft'}
          </div>
        ) : (
          <span className='font-medium text-primary'>
            {replies.replyCount} {replies.replyCount === 1 ? 'reply' : 'replies'}{' '}
            {draft && !isThreadOpen && ' and 1 draft'}
          </span>
        )}

        {replies.lastActivityAt && (
          <span className='relative inline-flex items-baseline text-muted-foreground whitespace-nowrap w-[140px]'>
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
