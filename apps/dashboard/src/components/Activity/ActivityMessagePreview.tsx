import { ReactElement, ReactNode } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageBubble } from '../ui/MessageBubble/MessageBubble';
import { RenderMessageWithHTML } from '../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { getFlowJsonPreviewText } from '../../utils/flowPreview';

type ActivityMessage = NonNullable<ActivityWithRelated['message']>;

/**
 * Shared renderer for the message preview inside an activity row.
 *
 * FlowJSON messages (Plan cards etc.) are collapsed to a single-line text
 * preview in BOTH expanded and collapsed modes. Otherwise the message content
 * would flow into RenderMessageWithHTML, which mounts the full interactive
 * FlowScreenManager card and dominates the activity feed. Collapsing keeps flow
 * notifications consistent with mentions/replies (a one-line preview).
 *
 * Non-flow messages keep the previous behavior:
 *  - expanded  -> full MessageBubble
 *  - collapsed -> a truncated single line (or the provided `collapsedContent`,
 *                 e.g. the reaction preview used by the reaction activities).
 */
export const ActivityMessagePreview = ({
  message,
  isExpanded,
  collapsedContent,
}: {
  message: ActivityMessage;
  isExpanded: boolean;
  collapsedContent?: ReactNode;
}): ReactElement => {
  const flowPreview = getFlowJsonPreviewText(message.content);

  if (flowPreview) {
    return (
      <div className='text-foreground text-sm line-clamp-1 truncate whitespace-normal break-all'>
        {flowPreview}
      </div>
    );
  }

  if (isExpanded) {
    return (
      <MessageBubble message={message} showAvatar={false} variant='default' contentOnly={true} />
    );
  }

  if (collapsedContent !== undefined) {
    return <>{collapsedContent}</>;
  }

  return (
    <div className='text-foreground text-sm line-clamp-1 truncate whitespace-normal break-all'>
      <RenderMessageWithHTML message={message.content} showEdited={message.edited} />
    </div>
  );
};
