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
  // A pending Twin draft for THIS thread (from the bulk badge context). Shown as
  // the "Twin draft" pill even when the thread has no replies yet — the freshest,
  // highest-value case, which the reply-count guards below would otherwise hide.
  const twinBadge = useTwinDraftBadge(replies?.conversation?.conversationId);
  // Surface a pending Twin draft using the SAME "1 draft" / "and 1 draft"
  // treatment as a user's own draft — no separate pill in the channel list.
  const showTwinDraft = !isThreadOpen && !!twinBadge;

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

  // A thread can carry BOTH the user's own composer draft AND a pending Twin
  // draft — count each so the indicator reads "1 draft" or "2 drafts". Same
  // neutral draft UI for both (no separate Twin styling in the channel list).
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
