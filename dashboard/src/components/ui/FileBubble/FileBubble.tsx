import React from 'react';
import Tooltip from '../Tooltip/Tooltip';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import { formatFullTimestamp } from '../../../utils/dateUtils';
import { useUser } from '../../../hooks/useUsers';
import {
  attachmentViewerActor,
  AttachmentRef,
  AttachmentViewerState,
} from '../../../machines/attachmentViewerMachine';
import { useSelector } from '@xstate/react';

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
  const isOpen = useSelector(
    attachmentViewerActor,
    (state: AttachmentViewerState) => state.value !== 'closed',
  );

  const handleClick = (): void => {
    if (onClick) {
      onClick();
      return;
    }
    const attachmentRef: AttachmentRef = {
      attachmentId: attachment.id,
      fileName: attachment.originalFilename,
      fileUrl: `/attachments/${attachment.id}/stream`,
      mimeType: attachment.mimetype,
      fileSize: attachment.size,
      thumbnailUrl: attachment.thumbnailUrl,
    };
    attachmentViewerActor.send({
      type: isOpen ? 'UPDATE' : 'OPEN',
      attachments: [attachmentRef],
      startIndex: 0,
    });
  };

  return (
    <div className='w-full py-1.5'>
      <button
        type='button'
        className='w-full text-left p-3 bg-card hover:bg-accent
           rounded-xl border border-border shadow-sm transition cursor-pointer'
        onClick={handleClick}
      >
        {/* Attachment Preview */}
        <div className='flex items-center gap-3'>
          {/* pointer-events-none so all clicks are handled by the outer button */}
          <div className='pointer-events-none'>
            <MessageAttachment attachment={attachment} compact={true} />
          </div>

          <div className='flex flex-col'>
            <div className='font-medium'>{attachment.originalFilename}</div>

            <Tooltip content={formatFullTimestamp(createdAt)} side='top'>
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
