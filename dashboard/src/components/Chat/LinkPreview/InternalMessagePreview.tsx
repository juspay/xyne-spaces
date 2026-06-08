import React, { useState } from 'react';
import { Hash, Lock, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  ChannelScopeType,
  Ticket,
  TicketPreviewSnapshot,
  ticketSnapshotToTicket,
} from '@xyne/shared';

import type { InternalMessageLinkMetadata } from './LinkPreview';
import { formatRelativeTimestamp } from '../../../utils/dateUtils';
import { usePlatform } from '../../../hooks/usePlatform';
import { isDMChannel } from '../ChatDirectory/ChatDirectory.utils';
import Avatar from '../../ui/Avatar/Avatar';
import { MessageAttachment } from '../MessageAttachment/MessageAttachment';
import { TicketCard } from '../../Tickets/TicketCard/TicketCard';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { API_BASE_URL, APPS_PUBLIC_BASE_URL } from '../../../config';

interface InternalMessagePreviewProps {
  metadata: InternalMessageLinkMetadata;
  onClose?: () => void;
}

const getInlinePreviewText = (html: string): string => {
  if (!html) return '';

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  } catch {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
};

const PreviewCloseButton: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  if (!onClose) return null;

  return (
    <button
      type='button'
      className='rounded-full p-0.5 opacity-0 transition-opacity hover:bg-secondary focus:outline-none focus-visible:opacity-100 group-hover:opacity-100'
      onClick={e => {
        e.stopPropagation();
        onClose();
      }}
      aria-label='Close preview'
      data-track-category='MESSAGE'
      data-track-name='CLOSE_INTERNAL_LINK_PREVIEW'
    >
      <X size={12} className='text-muted-foreground' />
    </button>
  );
};

const PreviewContainer: React.FC<{
  ariaLabel: string;
  onNavigate: (event?: React.MouseEvent | React.KeyboardEvent) => void;
  children: React.ReactNode;
}> = ({ ariaLabel, onNavigate, children }) => {
  return (
    <div
      className='internal-message-preview group relative flex w-full max-w-[460px] flex-col'
      aria-label={ariaLabel}
      onClick={onNavigate}
      data-track-category='MESSAGE'
      data-track-name='OPEN_INTERNAL_MESSAGE_PREVIEW'
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onNavigate(e);
        }
      }}
      role='button'
      tabIndex={0}
    >
      {children}
    </div>
  );
};

const AttachmentHeader: React.FC<{
  senderId?: string | undefined;
  senderName: string;
  formattedTime: string;
  onClose?: (() => void) | undefined;
}> = ({ senderId, senderName, formattedTime, onClose }) => (
  <div className='mb-1.5 flex items-center gap-2'>
    {senderId && <Avatar userId={senderId} size='sm' showActiveStatus={false} />}
    <span className='truncate text-[13px] font-semibold text-foreground'>{senderName}</span>
    <span className='text-xs text-muted-foreground'>{formattedTime}</span>
    {onClose && (
      <div className='ml-auto'>
        <PreviewCloseButton onClose={onClose} />
      </div>
    )}
  </div>
);

const MetadataFooter: React.FC<{
  channelName: string;
  isDM: boolean;
}> = ({ channelName, isDM }) => (
  <div className='mt-2 flex items-center gap-1.5 text-xs text-muted-foreground'>
    {isDM ? (
      <Lock size={11} className='flex-shrink-0' />
    ) : (
      <Hash size={11} className='flex-shrink-0' />
    )}
    <span className='truncate'>{isDM ? 'Direct message' : channelName}</span>
  </div>
);

const NestedLinkCard: React.FC<{
  nestedLinkPreview?: Record<string, unknown> | undefined;
}> = ({ nestedLinkPreview }) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const previewImage = nestedLinkPreview?.['image'] as string | undefined;
  const nestedTitle = nestedLinkPreview?.['title'] as string | undefined;
  const nestedDescription = nestedLinkPreview?.['description'] as string | undefined;
  const nestedUrl = nestedLinkPreview?.['url'] as string | undefined;
  const nestedFavicon = nestedLinkPreview?.['favicon'] as string | undefined;
  const nestedSiteName = nestedLinkPreview?.['siteName'] as string | undefined;

  if (!nestedLinkPreview || (!nestedTitle && !nestedDescription && !previewImage)) {
    return null;
  }

  return (
    <div className='mt-1.5 overflow-hidden rounded-lg border border-border bg-muted/50'>
      <div className='flex flex-col gap-1 p-2.5'>
        {(nestedFavicon || nestedSiteName) && (
          <div className='flex items-center gap-1.5'>
            {nestedFavicon && (
              <img
                src={nestedFavicon}
                alt=''
                className='h-4 w-4 rounded object-contain'
                loading='lazy'
                onError={e => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
            {nestedSiteName && (
              <span className='truncate text-[11px] text-muted-foreground'>{nestedSiteName}</span>
            )}
          </div>
        )}
        {nestedTitle && (
          <a
            href={nestedUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='block truncate text-xs font-medium text-primary hover:underline'
          >
            {nestedTitle}
          </a>
        )}
        {nestedDescription && (
          <p className='line-clamp-2 text-[11px] text-muted-foreground'>{nestedDescription}</p>
        )}
      </div>

      {previewImage && !imageError && (
        <div className='relative aspect-[2/1] w-full overflow-hidden border-t border-border'>
          {!imageLoaded && <div className='absolute inset-0 animate-pulse bg-muted' />}
          <img
            src={previewImage}
            alt={nestedTitle ?? ''}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading='eager'
            referrerPolicy='no-referrer'
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        </div>
      )}
    </div>
  );
};

const TicketPreview: React.FC<{
  ticket: Ticket;
  channelName: string;
  onNavigate: (event?: React.MouseEvent | React.KeyboardEvent) => void;
  onClose?: (() => void) | undefined;
}> = ({ ticket, channelName, onNavigate, onClose }) => (
  <PreviewContainer ariaLabel={`Ticket ${ticket.xyneId} in ${channelName}`} onNavigate={onNavigate}>
    {onClose && (
      <div className='mb-1 flex justify-end'>
        <PreviewCloseButton onClose={onClose} />
      </div>
    )}
    <TicketCard ticket={ticket} isConversation={true} />
  </PreviewContainer>
);

// Subscribes to the live ticket via Zero so the unfurl card reflects edits
// to the source ticket (title, status, assignee, etc.). Falls back to the
// snapshot serialized into link_preview_md while the query is loading or
// when the ticket is no longer accessible.
const LiveTicketPreview: React.FC<{
  ticketSnapshot: TicketPreviewSnapshot;
  channelName: string;
  onNavigate: (event?: React.MouseEvent | React.KeyboardEvent) => void;
  onClose?: (() => void) | undefined;
}> = ({ ticketSnapshot, channelName, onNavigate, onClose }) => {
  const [liveTicket] = useCachedQuery(queries.ticketById({ ticketId: ticketSnapshot.id }));
  const ticket = (liveTicket ?? ticketSnapshotToTicket(ticketSnapshot)) as Ticket;

  return (
    <TicketPreview
      ticket={ticket}
      channelName={channelName}
      onNavigate={onNavigate}
      onClose={onClose}
    />
  );
};

const AttachmentPreview: React.FC<{
  senderId?: string | undefined;
  senderName: string;
  formattedTime: string;
  channelName: string;
  attachments: NonNullable<InternalMessageLinkMetadata['attachments']>;
  onNavigate: (event?: React.MouseEvent | React.KeyboardEvent) => void;
  onClose?: (() => void) | undefined;
}> = ({ senderId, senderName, formattedTime, channelName, attachments, onNavigate, onClose }) => (
  <PreviewContainer
    ariaLabel={`Message from ${senderName} in ${channelName}`}
    onNavigate={onNavigate}
  >
    <AttachmentHeader
      senderId={senderId}
      senderName={senderName}
      formattedTime={formattedTime}
      onClose={onClose}
    />

    <div
      className='flex flex-wrap gap-2'
      data-prevent-drawer='true'
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
        }
      }}
      role='button'
      tabIndex={0}
      data-track-category='LINK_PREVIEW'
      data-track-name='ATTACHMENT_LINK_PREVIEW'
    >
      {attachments.map(att => (
        <div key={att.id}>
          <MessageAttachment
            attachment={att as unknown as Parameters<typeof MessageAttachment>[0]['attachment']}
          />
        </div>
      ))}
    </div>
  </PreviewContainer>
);

const TextPreview: React.FC<{
  senderId?: string | undefined;
  senderName: string;
  channelName: string;
  formattedTime: string;
  inlinePreviewText: string;
  isDeleted?: boolean | undefined;
  isDM: boolean;
  nestedLinkPreview?: Record<string, unknown> | undefined;
  onNavigate: (event?: React.MouseEvent | React.KeyboardEvent) => void;
  onClose?: (() => void) | undefined;
}> = ({
  senderId,
  senderName,
  channelName,
  formattedTime,
  inlinePreviewText,
  isDeleted,
  isDM,
  nestedLinkPreview,
  onNavigate,
  onClose,
}) => (
  <PreviewContainer
    ariaLabel={`Message from ${senderName} in ${channelName}`}
    onNavigate={onNavigate}
  >
    <div className='min-w-0 flex-1'>
      <div className='mb-1 flex items-start gap-2'>
        {senderId && <Avatar userId={senderId} size='sm' showActiveStatus={false} />}
        <div className='min-w-0 flex flex-1 items-center gap-2'>
          <span className='shrink-0 truncate text-xs font-medium text-foreground'>
            {senderName}
          </span>
          <span className='shrink-0 text-xs text-muted-foreground'>{formattedTime}</span>
          {onClose && (
            <div className='ml-auto'>
              <PreviewCloseButton onClose={onClose} />
            </div>
          )}
        </div>
      </div>

      {isDeleted ? (
        <p className='mb-1 text-[13px] italic text-muted-foreground'>This message was deleted.</p>
      ) : (
        <div className='mb-1 line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-muted-foreground'>
          {inlinePreviewText}
        </div>
      )}

      {!isDeleted && nestedLinkPreview && <NestedLinkCard nestedLinkPreview={nestedLinkPreview} />}

      <MetadataFooter channelName={channelName} isDM={isDM} />
    </div>
  </PreviewContainer>
);

const InternalMessagePreviewComponent: React.FC<InternalMessagePreviewProps> = ({
  metadata,
  onClose,
}) => {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();

  const {
    url,
    channelName,
    channelScopeType,
    senderId,
    senderName,
    content,
    timestamp,
    isDeleted,
    hasAttachment,
    attachments,
    nestedLinkPreview,
    ticket,
  } = metadata;

  const formattedTime = formatRelativeTimestamp(new Date(timestamp));
  const inlinePreviewText = getInlinePreviewText(content);
  const isDM = isDMChannel(channelScopeType as ChannelScopeType);
  const showAttachments = !isDeleted && hasAttachment && attachments && attachments.length > 0;

  const normalizeToCurrentOrigin = (targetUrl: URL): URL => {
    const currentHost = window.location.host;
    const targetHost = targetUrl.host;

    if (targetHost === currentHost) return targetUrl;

    // Derive known app domains from existing config (already environment-aware)
    const knownHosts = [new URL(API_BASE_URL).host, new URL(APPS_PUBLIC_BASE_URL).host];

    if (knownHosts.includes(targetHost)) {
      const normalized = new URL(targetUrl.href);
      normalized.host = currentHost;
      return normalized;
    }

    return targetUrl;
  };

  const handleNavigate = (event?: React.MouseEvent | React.KeyboardEvent): void => {
    if (!url) return;

    const isModifiedClick =
      !!event && 'metaKey' in event && !isMobile && (event.metaKey || event.ctrlKey);

    if (isModifiedClick) {
      window.open(url, '_blank');
      return;
    }

    try {
      const targetUrl = new URL(url, window.location.origin);
      const normalizedUrl = normalizeToCurrentOrigin(targetUrl);
      if (normalizedUrl.origin === window.location.origin) {
        void navigate(`${normalizedUrl.pathname}${normalizedUrl.search}${normalizedUrl.hash}`);
        return;
      }
    } catch {
      // Fall through to hard navigation for malformed relative URLs.
    }

    window.location.href = url;
  };

  if (ticket) {
    return (
      <LiveTicketPreview
        ticketSnapshot={ticket}
        channelName={channelName}
        onNavigate={handleNavigate}
        onClose={onClose}
      />
    );
  }

  if (showAttachments) {
    return (
      <AttachmentPreview
        senderId={senderId}
        senderName={senderName}
        formattedTime={formattedTime}
        channelName={channelName}
        attachments={attachments}
        onNavigate={handleNavigate}
        onClose={onClose}
      />
    );
  }

  return (
    <TextPreview
      senderId={senderId}
      senderName={senderName}
      channelName={channelName}
      formattedTime={formattedTime}
      inlinePreviewText={inlinePreviewText}
      isDeleted={isDeleted}
      isDM={isDM}
      nestedLinkPreview={nestedLinkPreview}
      onNavigate={handleNavigate}
      onClose={onClose}
    />
  );
};

export const InternalMessagePreview = React.memo(InternalMessagePreviewComponent);
