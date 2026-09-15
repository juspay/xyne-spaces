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
  siblings?: readonly MessageType['attachments'][number][];
  onClick?: () => void;
  createdBy: string;
  createdAt: number;
  compact?: boolean;
}

export const FileBubble: React.FC<FileBubbleProps> = ({
  attachment,
  siblings,
  onClick,
  createdBy,
  createdAt,
  compact = false,
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
    const gallery = siblings?.length ? siblings : [attachment];
    const attachmentRefs: AttachmentRef[] = gallery.map(att => ({
      attachmentId: att.id,
      fileName: att.originalFilename,
      fileUrl: `/attachments/${att.id}/download`,
      mimeType: att.mimetype,
      fileSize: att.size,
      thumbnailUrl: att.thumbnailUrl,
    }));
    attachmentViewerActor.send({
      type: isOpen ? 'UPDATE' : 'OPEN',
      attachments: attachmentRefs,
      startIndex: Math.max(
        0,
        gallery.findIndex(att => att.id === attachment.id),
      ),
    });
  };

  if (compact) {
    return (
      <button
        type='button'
        className='shrink-0 cursor-pointer'
        onClick={handleClick}
        data-track-category='MESSAGE'
        data-track-name='OPEN_FILE_BUBBLE'
        title={attachment.originalFilename}
      >
        <div className='pointer-events-none'>
          <MessageAttachment attachment={attachment} compact={true} />
        </div>
      </button>
    );
  }

  return (
    <div className='w-full py-1.5'>
      <button
        type='button'
        className='w-full text-left p-3 bg-card hover:bg-accent
           rounded-xl border border-border shadow-sm transition cursor-pointer'
        onClick={handleClick}
        data-track-category='MESSAGE'
        data-track-name='OPEN_FILE_BUBBLE'
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
