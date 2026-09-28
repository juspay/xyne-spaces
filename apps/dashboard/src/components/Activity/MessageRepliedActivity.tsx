import { ReactElement } from 'react';
import { parseSlashCommandArtifactMessage } from '@xyne/shared';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageBubble } from '../ui/MessageBubble/MessageBubble';
import { ActivityItemCard } from './ActivityItemCard';
import {
  SlashCommandArtifactActivityBody,
  SlashCommandArtifactBadge,
} from './SlashCommandArtifactActivity';
import { RenderMessageWithHTML } from '../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { getFlowJsonPreviewText } from '../../utils/flowPreview';
import { useUser } from '../../hooks/useUsers';
import { useRouteContext } from '../../hooks/useRouteContext';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { ChatTyping } from '@xyne/icons';

export const MessageRepliedActivity = ({
  activity,
  isExpanded = true,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const message = activity.message;
  const conversation = activity.conversation;
  const sender = useUser(message?.senderId ?? '');
  const artifact = parseSlashCommandArtifactMessage(message?.content);
  const { baseRoute } = useRouteContext();

  if (!message || !sender || !conversation) return null;
  const targetPath = `${baseRoute}/${conversation?.channelId}/${conversation?.conversationId}#origin=${conversation?.conversationId}&messageId=${message.messageId}`;
  const supportTargetPath =
    conversation?.channelId && conversation?.conversationId
      ? `/support/${conversation.channelId}?conversationId=${conversation.conversationId}&messageId=${message.messageId}`
      : undefined;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender.id}
      actorName={getUserDisplayName(sender)}
      channelId={conversation?.channelId}
      badgeIcon={<ChatTyping className='size-3 text-yellow-600' />}
      badgeColorClass='bg-muted'
      {...(artifact && {
        titlePrefix: <SlashCommandArtifactBadge badge={artifact.definition.badge} />,
      })}
      description={<span className='text-muted-foreground text-sm'>replied in</span>}
      targetPath={targetPath}
      focusThread
      supportTargetPath={supportTargetPath}
      linkedItemCreatedAt={conversation.createdAt}
      useActivityCutoff
      isExpanded={isExpanded}
    >
      {artifact ? (
        <SlashCommandArtifactActivityBody messageId={message.messageId} body={artifact.body} />
      ) : isExpanded ? (
        <MessageBubble
          message={message}
          showAvatar={false}
          variant='default'
          contentOnly={true}
          disableLinks={true}
        />
      ) : (
        <div className='text-foreground text-sm line-clamp-1 truncate whitespace-normal break-all'>
          {getFlowJsonPreviewText(message.content) ?? (
            <RenderMessageWithHTML
              message={message.content}
              showEdited={message.edited}
              disableLinks
            />
          )}
        </div>
      )}
    </ActivityItemCard>
  );
};
