// Channels desk tickets: the conversation the ticket was opened for stays in its own channel, named by the
// email row on the ticket (externalThreadId). It opens in the regular thread view; Zero only returns
// it to members of that channel, and everyone else on the desk sees why they can't open it.
import type { ReactElement } from 'react';
import { Hash, Lock } from 'lucide-react';
import ThreadMessages from '../../components/Chat/ThreadPannel';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useChannel } from '../../hooks/useChannels';
import { queries } from '../../zero/queries';

export function ChannelsDeskSourceThread({
  sourceConversationId,
}: {
  /** The merchant's thread, from the ticket's email row. */
  sourceConversationId: string;
}): ReactElement | null {
  const [conversation, details] = useCachedQuery(
    queries.threadConversationV2({ conversationId: sourceConversationId }),
  );

  if (!conversation?.channelId) {
    if (details.type !== 'complete' && details.type !== 'error') return null;
    return (
      <div className='flex flex-col items-center gap-2 px-6 py-16 text-center'>
        <Lock className='h-6 w-6 text-muted-foreground' />
        <div className='text-sm font-medium text-foreground'>
          You can&apos;t open this conversation
        </div>
        <div className='max-w-sm text-xs text-muted-foreground'>
          It&apos;s in a private channel you&apos;re not a member of, or the channel is no longer
          linked to this desk. Ask the channel&apos;s admin to add you.
        </div>
      </div>
    );
  }

  return (
    <ThreadMessages
      channelId={conversation.channelId}
      conversationId={sourceConversationId}
      // Its own ticket, not the desk ticket in the route.
      ticketId={conversation.ticketId ?? ''}
      defaultTab='thread'
      deskView
    />
  );
}

/** The ticket header's Channel chip: which channel the ticket came from. Only its members can read a private channel's name. */
export function ChannelsDeskSourceChannel({
  sourceConversationId,
}: {
  sourceConversationId: string;
}): ReactElement | null {
  const [conversation, details] = useCachedQuery(
    queries.threadConversationV2({ conversationId: sourceConversationId }),
  );
  const channel = useChannel(conversation?.channelId ?? '');
  if (conversation?.channelId ? !channel : details.type !== 'complete') return null;

  return (
    <div className='flex items-center gap-1.5 pr-3 mr-1.5 border-r border-border'>
      <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none shrink-0'>
        Channel
      </span>
      <div className='inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted text-xs text-foreground whitespace-nowrap h-[24px]'>
        {channel ? (
          <Hash size={12} className='shrink-0 text-muted-foreground' />
        ) : (
          <Lock size={12} className='shrink-0 text-muted-foreground' />
        )}
        <span className='truncate max-w-[160px]'>{channel?.name ?? 'Private channel'}</span>
      </div>
    </div>
  );
}
