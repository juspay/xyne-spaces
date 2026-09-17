import React, { ReactElement } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { TicketStatusIcon } from '../../../assets/icons';
import { TicketPriorityIcon } from '../../../assets/icons';
import SmallUserAvatar from '../../UserAvatar/SmallUserAvatar';
import { Calendar, Tag, Archive, Mail, FileText } from 'lucide-react';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { MessageWithOptionalNudgeCounts } from '../../ui/MessageBubble/MessageBubble.types';
import { StageMoveFormBlock } from './StageMoveFormBlock';

interface TicketActivityMessageProps {
  message: MessageWithOptionalNudgeCounts;
  isPrevActivity?: boolean;
  isNextActivity?: boolean;
}

const formatTimestamp = (timestamp: number | string | Date): string => {
  try {
    const date =
      typeof timestamp === 'number' || typeof timestamp === 'string'
        ? new Date(timestamp)
        : timestamp;
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return '';
  }
};

// Full, exact timestamp shown in the hover tooltip (the row itself shows the relative time).
const formatExactTimestamp = (timestamp: number | string | Date): string => {
  try {
    const date =
      typeof timestamp === 'number' || typeof timestamp === 'string'
        ? new Date(timestamp)
        : timestamp;
    return format(date, "MMM d, yyyy 'at' h:mm:ss a");
  } catch {
    return '';
  }
};

// A stage-move system message reads: `… moved ticket from "<from>" to "<to>"`. Extract the target
// stage so the thread can show the same form-submission block the Details timeline shows for that
// move. The quote immediately after `from ` also excludes board moves (`… from board "…" to "…"`).
const parseStageMoveTarget = (content: string | null | undefined): string | null => {
  if (!content) return null;
  const match = content.match(/moved ticket from "[^"]*" to "([^"]+)"/);
  return match ? (match[1] ?? null) : null;
};

const addAutomationActorLabel = (
  content: string,
  metadata: Record<string, unknown> | null,
): string =>
  metadata?.['isAutomation'] === true && !content.includes('(Automation)')
    ? content.replace(/\s(?=(?:changed status|moved ticket)\b)/, ' (Automation) ')
    : content;

export const TicketActivityMessage: React.FC<TicketActivityMessageProps> = ({
  message,
  isPrevActivity = false,
  isNextActivity = false,
}) => {
  const metadata = message?.metadata as Record<string, unknown> | null;
  const displayContent = addAutomationActorLabel(message.content, metadata);
  const stageMoveTarget = parseStageMoveTarget(message.content);
  const getIcon = (): ReactElement => {
    switch (metadata?.['activityType']) {
      case 'PRIORITY':
        return <TicketPriorityIcon size={12} />;
      case 'STATUS':
      case 'STAGE_NAME':
      case 'PR':
      case 'STAGE_CHANGE_REQUEST':
      case 'STAGE_CHANGE_APPROVED':
      case 'STAGE_CHANGE_REJECTED':
        return <TicketStatusIcon size={12} />;
      case 'EMAIL_REPLY':
        return <Mail size={12} className='text-blue-600' />;
      case 'TAGS':
        return <Tag size={12} className='text-gray-400' />;
      case 'ETA':
        return <Calendar size={12} />;
      case 'IS_ARCHIVED':
        return <Archive size={12} className='text-amber-600' />;
      case 'RELEASE_SYNC':
        return <FileText size={12} className='text-blue-600' />;
      default:
        return <SmallUserAvatar userId={message.senderId} />;
    }
  };

  return (
    <div
      className={`flex justify-start ${isPrevActivity ? '' : 'mt-2'}`}
      data-testid='ticket-activity'
    >
      <div className='flex items-start gap-2 px-4 w-full text-sm text-muted-foreground'>
        {/* Icon + connecting line, aligned within the avatar column */}
        <div className='w-8 flex-shrink-0 flex flex-col items-center self-stretch mt-0.5'>
          {getIcon()}
          {isNextActivity && <span className='w-0 flex-1 my-1 border-[0.8px] border-border' />}
        </div>

        {/* Content with inline timestamp */}
        <div className='flex-1 min-w-0 -mt-1 pb-3'>
          <div className='flex items-baseline flex-wrap gap-x-2'>
            <div className='[&_.jp-message-html]:text-muted-foreground [&_.jp-message-html]:text-[13px]'>
              <RenderMessageWithHTML message={displayContent} isSystemMessage />
            </div>
            <Tooltip content={formatExactTimestamp(message.createdAt)}>
              <span className='text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 cursor-default'>
                {formatTimestamp(message.createdAt)}
              </span>
            </Tooltip>
          </div>
          {/* Same form-submission block as the Details activity timeline, for stage-move messages */}
          {stageMoveTarget && (
            <StageMoveFormBlock
              conversationId={message.conversationId}
              toStageName={stageMoveTarget}
              timestamp={message.createdAt}
            />
          )}
        </div>
      </div>
    </div>
  );
};
