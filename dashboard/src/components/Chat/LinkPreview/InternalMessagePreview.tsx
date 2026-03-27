import React, { useState } from 'react';
import { Hash, Lock, MessageSquare, X } from 'lucide-react';
import type { InternalMessageLinkMetadata } from './LinkPreview';
import { formatRelativeTimestamp } from '../../../utils/dateUtils';
import { ChannelScopeType, Ticket, ticketSnapshotToTicket } from '@xyne/shared';
import { MessageAttachment } from '../MessageAttachment/MessageAttachment';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import Avatar from '../../ui/Avatar/Avatar';
import { TicketCard } from '../../Tickets/TicketCard/TicketCard';
import { isDMChannel } from '../ChatDirectory/ChatDirectory.utils';

interface InternalMessagePreviewProps {
  metadata: InternalMessageLinkMetadata;
  onClose?: () => void;
}

/** Shared header row used by ticket and attachment layouts */
const PreviewHeader: React.FC<{
  senderId?: string;
  senderName: string;
  formattedTime: string;
  onClose?: (() => void) | undefined;
}> = ({ senderId, senderName, formattedTime, onClose }) => (
  <div className='flex items-center gap-2 mb-1.5'>
    {senderId && <Avatar userId={senderId} size='sm' showActiveStatus={false} />}
    <span className='text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate'>
      {senderName}
    </span>
    <span className='text-xs text-gray-400 dark:text-gray-500'>{formattedTime}</span>
    {onClose && (
      <button
        type='button'
        className='ml-auto p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none'
        onClick={e => {
          e.stopPropagation();
          onClose();
        }}
        aria-label='Close preview'
        data-track-category='MESSAGE'
        data-track-name='CLOSE_INTERNAL_LINK_PREVIEW'
      >
        <X size={12} className='text-gray-500 dark:text-gray-400' />
      </button>
    )}
  </div>
);

const InternalMessagePreviewComponent: React.FC<InternalMessagePreviewProps> = ({
  metadata,
  onClose,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const {
    channelName,
    channelScopeType,
    senderId,
    senderName,
    content,
    timestamp,
    replyCount,
    isDeleted,
    hasAttachment,
    attachments,
    nestedLinkPreview,
  } = metadata;

  const isDM = isDMChannel(channelScopeType as ChannelScopeType);

  // OG image from the nested link preview
  const previewImage = nestedLinkPreview?.['image'] as string | undefined;

  const nestedTitle = nestedLinkPreview?.['title'] as string | undefined;
  const nestedDescription = nestedLinkPreview?.['description'] as string | undefined;
  const nestedUrl = nestedLinkPreview?.['url'] as string | undefined;
  const nestedFavicon = nestedLinkPreview?.['favicon'] as string | undefined;
  const nestedSiteName = nestedLinkPreview?.['siteName'] as string | undefined;

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose?.();
  };

  const formattedTime = formatRelativeTimestamp(new Date(timestamp));

  const showAttachments = !isDeleted && hasAttachment && attachments && attachments.length > 0;

  // ── Ticket layout: render TicketCard when ticket data is present ──
  if (metadata.ticket) {
    const ticketData = ticketSnapshotToTicket(metadata.ticket) as Ticket;
    return (
      <div
        className='internal-message-preview relative flex flex-col w-full max-w-[460px]'
        aria-label={`Ticket ${ticketData.xyneId} in ${channelName}`}
      >
        <PreviewHeader
          senderId={senderId}
          senderName={senderName}
          formattedTime={formattedTime}
          onClose={onClose}
        />
        <TicketCard ticket={ticketData} isConversation={true} />
      </div>
    );
  }

  // ── Attachment-only layout: just a header line + normal full-size attachments ──
  if (showAttachments) {
    return (
      <div
        className='internal-message-preview relative flex flex-col w-full max-w-[460px]'
        aria-label={`Message from ${senderName} in ${channelName}`}
      >
        <PreviewHeader
          senderId={senderId}
          senderName={senderName}
          formattedTime={formattedTime}
          onClose={onClose}
        />

        {/* Normal full-size attachments */}
        <div className='flex flex-wrap gap-2' data-prevent-drawer='true'>
          {attachments.map(att => (
            <div key={att.id}>
              <MessageAttachment
                attachment={att as unknown as Parameters<typeof MessageAttachment>[0]['attachment']}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Standard text-only preview card ──
  return (
    <div
      className='internal-message-preview relative flex flex-col w-full max-w-[460px] rounded-2xl border border-[#D3DAE0A8] dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800'
      aria-label={`Message from ${senderName} in ${channelName}`}
    >
      {onClose && (
        <button
          type='button'
          className='absolute top-2 right-2 z-10 p-1 rounded-full bg-gray-100/80 dark:bg-gray-700/80 hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400'
          onClick={handleClose}
          aria-label='Close preview'
          data-track-category='MESSAGE'
          data-track-name='CLOSE_INTERNAL_LINK_PREVIEW'
        >
          <X size={14} className='text-gray-600 dark:text-gray-300' />
        </button>
      )}

      <div className='p-3 pr-8 flex flex-col gap-1.5'>
        {/* Sender row: avatar + name + timestamp */}
        <div className='flex items-center gap-2'>
          {senderId && <Avatar userId={senderId} size='sm' showActiveStatus={false} />}

          <span className='text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate'>
            {senderName}
          </span>
        </div>

        {/* Message content */}
        {isDeleted ? (
          <p className='text-[13px] text-gray-400 dark:text-gray-500 italic ml-8'>
            This message was deleted.
          </p>
        ) : (
          <div className='jp-message-html text-[13px] text-gray-700 dark:text-gray-300 line-clamp-4 break-words whitespace-pre-wrap ml-8'>
            <RenderMessageWithHTML message={content} />
          </div>
        )}

        {/* Nested link preview from the original message (inline, like Slack) */}
        {!isDeleted && nestedLinkPreview && (nestedTitle || nestedDescription || previewImage) && (
          <div className='ml-8 mt-1.5 rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-50 dark:bg-gray-750'>
            <div className='p-2.5 flex flex-col gap-1'>
              {/* Site info row */}
              {(nestedFavicon || nestedSiteName) && (
                <div className='flex items-center gap-1.5'>
                  {nestedFavicon && (
                    <img
                      src={nestedFavicon}
                      alt=''
                      className='w-4 h-4 rounded object-contain'
                      loading='lazy'
                      onError={e => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                  {nestedSiteName && (
                    <span className='text-[11px] text-gray-500 dark:text-gray-400 truncate'>
                      {nestedSiteName}
                    </span>
                  )}
                </div>
              )}
              {nestedTitle && (
                <a
                  href={nestedUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline truncate block'
                >
                  {nestedTitle}
                </a>
              )}
              {nestedDescription && (
                <p className='text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2'>
                  {nestedDescription}
                </p>
              )}
            </div>

            {/* OG image from the nested link preview */}
            {previewImage && !imageError && (
              <div className='relative w-full overflow-hidden aspect-[2/1] border-t border-gray-200 dark:border-gray-600'>
                {!imageLoaded && (
                  <div className='absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-700' />
                )}
                <img
                  src={previewImage}
                  alt={nestedTitle ?? ''}
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  loading='eager'
                  referrerPolicy='no-referrer'
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageError(true)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer: channel + reply count */}
      <div className='flex items-center gap-1.5 px-3 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400'>
        {isDM ? (
          <Lock size={11} className='flex-shrink-0' />
        ) : (
          <Hash size={11} className='flex-shrink-0' />
        )}
        <span className='truncate'>{isDM ? 'Direct message' : channelName}</span>

        {replyCount !== null && replyCount !== undefined && replyCount > 0 && (
          <>
            <span className='text-gray-300 dark:text-gray-600'>·</span>
            <MessageSquare size={11} className='flex-shrink-0' />
            <span>
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </>
        )}

        <span className='text-gray-300 dark:text-gray-600'>·</span>
        <span className='text-xs text-gray-400 dark:text-gray-500'>{formattedTime}</span>
      </div>
    </div>
  );
};

export const InternalMessagePreview = React.memo(InternalMessagePreviewComponent);
