import React, { ReactElement } from 'react';
import { TicketStatusIcon } from '../../../assets/icons';
import { TicketPriorityIcon } from '../../../assets/icons';
import SmallUserAvatar from '../../UserAvatar/SmallUserAvatar';
import { Calendar, Tag, Archive } from 'lucide-react';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { MessageWithOptionalNudgeCounts } from '../../ui/MessageBubble/MessageBubble.types';

interface TicketActivityMessageProps {
  message: MessageWithOptionalNudgeCounts;
}

export const TicketActivityMessage: React.FC<TicketActivityMessageProps> = ({ message }) => {
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
    <div className='flex justify-start min-[500px]:px-4 px-2 my-3' data-testid='ticket-activity'>
      <div className='flex items-center gap-2 text-sm text-muted-foreground px-10 py-0.5'>
        {getIcon()}
        <div>
          <RenderMessageWithHTML message={message.content} />
        </div>
      </div>
    </div>
  );
};
