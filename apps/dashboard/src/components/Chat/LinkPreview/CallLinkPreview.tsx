import React from 'react';
import { Copy, Phone, X } from 'lucide-react';
import { toast } from 'sonner';
import { CallStatus, type CallPreviewData } from '@xyne/shared';

import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUser } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';

interface CallLinkPreviewProps {
  metadata: CallPreviewData;
  onClose?: (() => void) | undefined;
}

interface StatusPresentation {
  label: string;
  /** Tailwind classes for the pill. */
  className: string;
  /** Pulsing dot for a call happening right now. */
  live?: boolean;
}

/** IN_PROGRESS folds into ACTIVE: both mean "happening now". */
const STATUS_PRESENTATION: Record<CallStatus, StatusPresentation> = {
  [CallStatus.ACTIVE]: {
    label: 'Live',
    className: 'bg-stage-completed text-[var(--status-success)]',
    live: true,
  },
  [CallStatus.IN_PROGRESS]: {
    label: 'Live',
    className: 'bg-stage-completed text-[var(--status-success)]',
    live: true,
  },
  [CallStatus.SCHEDULED]: {
    label: 'Scheduled',
    className: 'bg-blue-500/10 text-status-scheduled',
  },
  [CallStatus.ENDED]: {
    label: 'Ended',
    className: 'bg-muted text-muted-foreground',
  },
  [CallStatus.CANCELLED]: {
    label: 'Cancelled',
    className: 'bg-stage-cancelled text-status-failure line-through',
  },
};

/**
 * Unfurl card for a Xyne call link.
 *
 * Everything shown is read live via Zero; link_preview_md only carries the id. Until the row
 * arrives, or when calls-acl denies it, the card is a plain "Xyne call" link with no pill.
 */
const CallLinkPreviewComponent: React.FC<CallLinkPreviewProps> = ({ metadata, onClose }) => {
  const { url, externalId } = metadata;

  const [call] = useCachedQuery(queries.callPreviewByExternalId({ externalId }));
  const creator = useUser(call?.createdByUserId ?? '');
  const creatorName = getUserDisplayName(creator);

  // Ad-hoc calls have no title; name them after the creator, like the schedule modal.
  const title =
    call?.title ||
    (creatorName !== 'Unknown' ? `${creatorName.split(' ')[0]}'s Call` : 'Xyne call');
  const presentation = call ? STATUS_PRESENTATION[call.status] : undefined;

  const handleClose = (event: React.MouseEvent): void => {
    event.stopPropagation();
    onClose?.();
  };

  const handleCopy = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Link copied to clipboard'))
      .catch(() => toast.error('Failed to copy link'));
  };

  return (
    <div
      className='call-link-preview relative flex w-full max-w-[380px] items-center gap-2 overflow-hidden rounded-lg border border-border bg-card py-1.5 pl-2 pr-14'
      aria-label={`Call preview: ${title}${presentation ? ` (${presentation.label})` : ''}`}
    >
      <div className='absolute right-1 top-1 z-10 flex items-center gap-1'>
        <button
          type='button'
          className='call-link-preview__copy-button rounded-full bg-muted p-0.5 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring'
          onClick={handleCopy}
          aria-label='Copy call link'
          title='Copy call link'
          data-track-category='MESSAGE'
          data-track-name='COPY_CALL_LINK_PREVIEW'
        >
          <Copy size={12} className='text-muted-foreground' />
        </button>
        {onClose && (
          <button
            type='button'
            className='call-link-preview__close-button rounded-full bg-muted p-0.5 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring'
            onClick={handleClose}
            aria-label='Close call preview'
            data-track-category='MESSAGE'
            data-track-name='CLOSE_CALL_LINK_PREVIEW'
          >
            <X size={12} className='text-muted-foreground' />
          </button>
        )}
      </div>

      {/* Matches the "Join call" chip above. */}
      <Phone size={14} className='shrink-0 text-muted-foreground' aria-hidden='true' />

      {presentation ? (
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${presentation.className}`}
        >
          {presentation.live && (
            <span
              className='h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--status-success)]'
              aria-hidden='true'
            />
          )}
          {presentation.label}
        </span>
      ) : null}

      <a
        href={url}
        target='_blank'
        rel='noopener noreferrer'
        className='min-w-0 flex-1 truncate text-sm text-foreground hover:underline'
        title={title}
        data-track-category='MESSAGE'
        data-track-name='OPEN_CALL_LINK_PREVIEW'
      >
        {title}
      </a>
    </div>
  );
};

export const CallLinkPreview = React.memo(CallLinkPreviewComponent);
export default CallLinkPreview;
