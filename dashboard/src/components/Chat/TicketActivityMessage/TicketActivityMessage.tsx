import React, { ReactElement } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { TicketStatusIcon } from '../../../assets/icons';
import { TicketPriorityIcon } from '../../../assets/icons';
import SmallUserAvatar from '../../UserAvatar/SmallUserAvatar';
import { Calendar, Tag } from 'lucide-react';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';

interface TicketActivityMessageProps {
  message: QueryResultType<typeof queries.conversationMessages>[number];
}

export const TicketActivityMessage: React.FC<TicketActivityMessageProps> = ({ message }) => {
  const metadata = message?.metadata as Record<string, unknown> | null;
  const getIcon = (): ReactElement => {
    switch (metadata?.['activityType']) {
      case 'PRIORITY':
        return <TicketPriorityIcon />;
      case 'STATUS':
      case 'STAGE_NAME':
      case 'PR':
      case 'STAGE_CHANGE_REQUEST':
      case 'STAGE_CHANGE_APPROVED':
      case 'STAGE_CHANGE_REJECTED':
        return <TicketStatusIcon />;
      case 'TAGS':
        return <Tag />;
      case 'ETA':
        return <Calendar />;
      default:
        return <SmallUserAvatar userId={message.senderId} />;
    }
  };

  return (
    <div className='flex justify-start min-[500px]:px-4 px-2 my-3' data-testid='ticket-activity'>
      <div className='flex items-center gap-2 text-sm text-gray-400 px-10 py-0.5'>
        {getIcon()}
        <div>
          <RenderMessageWithHTML message={message.content} />
        </div>
      </div>
    </div>
  );
};
