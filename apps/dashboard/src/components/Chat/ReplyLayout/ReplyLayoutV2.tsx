import { useParams } from 'react-router-dom';
import { ThreadData } from '../ChatBubble/ChatBubble';
import { PencilIcon } from 'lucide-react';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import { formatRelativeTime } from '../../../utils/dateUtils';
import { ViewNewerRepliesButton } from '../../ui/MessageBubble/ThreadMessageIndicators';
import { parseRepliesMd } from '@xyne/shared';
import { useTwinDraftBadge } from '../TwinReplyDraft/TwinDraftBadgeContext';

const ReplyLayoutV2: React.FC<{
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
  const { channelId } = useParams<{ channelId: string }>();
  const twinBadge = useTwinDraftBadge(replies?.conversation?.conversationId);
  const showTwinDraft = !isThreadOpen && !!twinBadge;

  // A thread-linked "take notes" recording sets conversation.callId while
  // ACTIVE (mirrors how a regular in-thread call does) and clears it when it
  // ends — see noteTakerCallRepository. conversation.metadata.isHeadlessRecording
  // is stamped/cleared alongside it, so both checks read directly off this
  // already-subscribed conversation row — no separate per-thread-row query.
  const activeCallId = replies?.conversation?.callId;
  const conversationMetadata = replies?.conversation?.metadata as
    | { isHeadlessRecording?: boolean }
    | null
    | undefined;
  const isRecordingActive = !!activeCallId && conversationMetadata?.isHeadlessRecording === true;

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
  if ((!replies || replies.replyCount === 0) && (!hasDraft || isThreadOpen) && !showTwinDraft)
    return null;

  const zeroReplyDraftCount = (hasDraft ? 1 : 0) + (showTwinDraft ? 1 : 0);
  const inlineDraftCount = (draft && !isThreadOpen ? 1 : 0) + (showTwinDraft ? 1 : 0);
  const draftWord = (n: number): string => `${n} draft${n > 1 ? 's' : ''}`;

  const repliesData = parseRepliesMd(replies.conversation?.replies_md);
  const repliers = repliesData.repliers;

  return (
    <div
      className={`flex items-center gap-2 max-w-md pt-2 ${
        isMe
          ? 'min-[500px]:ml-14 max-[500px]:ml-auto max-[500px]:-mt-3'
          : 'min-[500px]:ml-14 max-[500px]:ml-12'
      } `}
    >
      <button
        type='button'
        onClick={replies.onOpenThread}
        className={`group flex items-center gap-2 text-xs bg-transparent border-0 cursor-pointer transition-opacity duration-200 hover:opacity-80 flex-1 ${
          isMe ? 'max-[500px]:justify-end' : ''
        }`}
        data-track-category='MESSAGE'
        data-track-name='OPEN_THREAD_FROM_REPLY_LAYOUT'
        data-track-metadata={JSON.stringify({ replyCount: replies?.replyCount, messageId })}
      >
        {/* Replier Avatars */}
        {repliers.length > 0 && <AvatarGroup userIds={repliers} size='sm' count={3} />}
        {!replies || replies.replyCount === 0 ? (
          zeroReplyDraftCount > 0 ? (
            <div className='flex items-center gap-1 font-medium text-primary'>
              <PencilIcon size={10} />
              {draftWord(zeroReplyDraftCount)}
            </div>
          ) : null
        ) : (
          <span className='font-medium text-foreground'>
            {replies.replyCount} {replies.replyCount === 1 ? 'reply' : 'replies'}
            {inlineDraftCount > 0 && ` and ${draftWord(inlineDraftCount)}`}
          </span>
        )}

        {isRecordingActive && (
          <span className='flex items-center gap-1 shrink-0 font-medium text-status-failure'>
            <span className='relative flex size-1.5'>
              <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-status-failure opacity-75' />
              <span className='relative inline-flex rounded-full size-1.5 bg-status-failure' />
            </span>
            Recording
          </span>
        )}

        {replies.lastActivityAt && (
          <span className='relative inline-flex items-baseline text-muted-foreground whitespace-nowrap w-[140px]'>
            <span
              className={`absolute left-0 top-0 ${isMe ? 'max-[500px]:right-0' : ''} transition-opacity duration-150 opacity-100 group-hover:opacity-0`}
            >
              Last activity {formatRelativeTime(replies.lastActivityAt)}
            </span>

            <span
              className={`absolute left-0 top-0 ${isMe ? 'max-[500px]:right-0' : ''} transition-opacity duration-150 opacity-0 group-hover:opacity-100`}
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

export default ReplyLayoutV2;
