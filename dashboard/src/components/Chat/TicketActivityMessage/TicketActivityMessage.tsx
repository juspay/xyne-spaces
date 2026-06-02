import React, { ReactElement } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { TicketStatusIcon } from '../../../assets/icons';
import { TicketPriorityIcon } from '../../../assets/icons';
import SmallUserAvatar from '../../UserAvatar/SmallUserAvatar';
import { Calendar, Tag, Archive } from 'lucide-react';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { MessageWithOptionalNudgeCounts } from '../../ui/MessageBubble/MessageBubble.types';

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

export const TicketActivityMessage: React.FC<TicketActivityMessageProps> = ({
  message,
  isPrevActivity = false,
  isNextActivity = false,
}) => {
  const metadata = message?.metadata as Record<string, unknown> | null;
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
      case 'TAGS':
        return <Tag size={12} className='text-gray-400' />;
      case 'ETA':
        return <Calendar size={12} />;
      case 'IS_ARCHIVED':
        return <Archive size={12} className='text-amber-600' />;
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
        <div className='flex-1 min-w-0 -mt-1 pb-3 flex items-baseline flex-wrap gap-x-2'>
          <div className='[&_.jp-message-html]:text-muted-foreground [&_.jp-message-html]:text-[13px]'>
            <RenderMessageWithHTML message={message.content} isSystemMessage />
          </div>
          <span className='text-xs text-muted-foreground whitespace-nowrap flex-shrink-0'>
            {formatTimestamp(message.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
};
