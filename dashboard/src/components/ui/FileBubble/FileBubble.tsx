import React from 'react';
import { Tooltip, TooltipSide } from '@juspay/blend-design-system';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import { formatFullTimestamp } from '../../../utils/dateUtils';
import { useUser } from '../../../hooks/useUsers';

type MessageType = QueryResultType<typeof queries.conversationMessagesV2>[number];

interface FileBubbleProps {
  attachment: MessageType['attachments'][number];
  onClick?: () => void;
  createdBy: string;
  createdAt: number;
}

export const FileBubble: React.FC<FileBubbleProps> = ({
  attachment,
  onClick,
  createdBy,
  createdAt,
}) => {
  const user = useUser(createdBy);

  return (
    <div className='w-full py-1.5'>
      <button
        type='button'
        className='w-full text-left p-3 bg-card hover:bg-accent
           rounded-xl border border-border shadow-sm transition cursor-pointer'
        onClick={onClick}
      >
        {/* Attachment Preview */}
        <div className='flex items-center gap-3'>
          <MessageAttachment attachment={attachment} compact={true} />

          <div className='flex flex-col'>
            <div className='font-medium'>{attachment.originalFilename}</div>

            <Tooltip content={formatFullTimestamp(createdAt)} side={TooltipSide.TOP}>
              <div className='text-xs text-muted-foreground'>
                Shared by {user?.name} on{' '}
                {new Date(createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  year: 'numeric',
                  day: 'numeric',
                })}
              </div>
            </Tooltip>
          </div>
        </div>
      </button>
    </div>
  );
};
