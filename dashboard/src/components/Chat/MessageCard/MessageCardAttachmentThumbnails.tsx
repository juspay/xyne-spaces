import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { Play, Video } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import {
  attachmentViewerActor,
  type AttachmentRef,
} from '../../../machines/attachmentViewerMachine';
import { createPreviewUrl } from '../../../services/clients/fileFetchService';
import { getFileExtension } from '../../Chat/MessageAttachment/utils';

export type PanelAttachmentRow = {
  id: string;
  mimetype: string;
  originalFilename: string;
  thumbnailUrl?: string | null | undefined;
  size: number;
};

function isImageMime(m: string): boolean {
  return m.toLowerCase().startsWith('image/');
}

function isVideoMime(m: string): boolean {
  return m.toLowerCase().startsWith('video/');
}

function isAudioMime(m: string): boolean {
  return m.toLowerCase().startsWith('audio/');
}

function isPdfMime(m: string): boolean {
  return m.toLowerCase() === 'application/pdf';
}

function isArchiveMime(mimeType: string): boolean {
  return (
    mimeType.toLowerCase().includes('zip') ||
    mimeType.toLowerCase().includes('rar') ||
    mimeType.toLowerCase().includes('7z') ||
    mimeType.toLowerCase().includes('tar')
  );
}

type FileThumbMeta = {
  extension: string;
  label: string;
  badgeClassName: string;
  iconSrc?: string;
};

/**
 * Matches FileList/attachment preview icon treatment where available
 * and falls back to colored extension badges for other file types.
 */
function getFileThumbMeta(mimeType: string): FileThumbMeta {
  const ext = getFileExtension(mimeType);
  const lowerMime = mimeType.toLowerCase();

  if (isPdfMime(lowerMime)) {
    return {
      extension: ext,
      label: 'PDF document',
      badgeClassName: 'bg-red-500 text-white',
      iconSrc: '/svgs/icons/attachment-icons/pdf.svg',
    };
  }

  const isWordDoc =
    lowerMime === 'application/msword' ||
    lowerMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (isWordDoc) {
    return {
      extension: ext,
      label: 'Word document',
      badgeClassName: 'bg-blue-600 text-white',
      iconSrc: '/svgs/icons/attachment-icons/docx.svg',
    };
  }

  const isExcelDoc =
    lowerMime === 'application/vnd.ms-excel' ||
    lowerMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (isExcelDoc) {
    return {
      extension: ext,
      label: 'Excel spreadsheet',
      badgeClassName: 'bg-green-600 text-white',
      iconSrc: '/svgs/icons/attachment-icons/excel.svg',
    };
  }

  if (lowerMime === 'text/csv' || lowerMime.includes('csv')) {
    return {
      extension: ext,
      label: 'CSV file',
      badgeClassName: 'bg-teal-500 text-white',
      iconSrc: '/svgs/icons/attachment-icons/csv.svg',
    };
  }

  if (isAudioMime(lowerMime)) {
    return { extension: ext, label: 'Audio file', badgeClassName: 'bg-green-500 text-white' };
  }
  if (isArchiveMime(lowerMime)) {
    return { extension: ext, label: 'Archive file', badgeClassName: 'bg-amber-500 text-white' };
  }
  if (ext === 'PPT' || ext === 'PPTX') {
    return { extension: ext, label: 'Presentation', badgeClassName: 'bg-orange-500 text-white' };
  }
  if (
    ext === 'TXT' ||
    ext === 'MD' ||
    ext === 'JSON' ||
    ext === 'JS' ||
    ext === 'TS' ||
    ext === 'HTML' ||
    ext === 'CSS'
  ) {
    return { extension: ext, label: 'Text file', badgeClassName: 'bg-slate-500 text-white' };
  }

  return { extension: ext, label: 'File', badgeClassName: 'bg-gray-500 text-white' };
}

/**
 * Loads preview via axios (auth) — raw <img src="/attachments/..."> does not send credentials.
 * Same approach as MessageAttachment Preview (createPreviewUrl).
 */
function PanelAuthImageThumb({
  attachmentId,
  mimeType,
  thumbnailUrl,
  className,
}: {
  attachmentId: string;
  mimeType: string;
  thumbnailUrl?: string | null;
  className?: string;
}): ReactElement {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isVideo = isVideoMime(mimeType);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const source =
          isVideo && thumbnailUrl ? `/attachments/${attachmentId}/thumbnail` : attachmentId;
        const blob = await createPreviewUrl(source);
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setBlobUrl(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return (): void => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attachmentId, mimeType, isVideo, thumbnailUrl]);

  if (loading) {
    return <div className={cn('bg-muted animate-pulse', className)} aria-hidden />;
  }
  if (!blobUrl) {
    return (
      <div className={cn('bg-muted flex items-center justify-center', className)} aria-hidden>
        <Video className='h-4 w-4 text-muted-foreground' />
      </div>
    );
  }
  return <img src={blobUrl} alt='' className={cn('object-cover', className)} loading='lazy' />;
}

export function MessageCardAttachmentThumbnails({
  attachments,
  className,
  trackCategory = 'MESSAGE_CARD',
}: {
  attachments: PanelAttachmentRow[];
  className?: string;
  /** Matches parent MessageCard / panel (local-rules/require-tracking-on-click) */
  trackCategory?: string;
}): ReactElement | null {
  const openViewer = useCallback(
    (startId: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const refs: AttachmentRef[] = attachments.map(att => ({
        attachmentId: att.id,
        fileName: att.originalFilename,
        fileUrl: `/attachments/${att.id}/download`,
        mimeType: att.mimetype,
        fileSize: att.size,
        thumbnailUrl: att.thumbnailUrl ?? null,
      }));
      const startIndex = refs.findIndex(r => r.attachmentId === startId);
      attachmentViewerActor.send({
        type: 'OPEN',
        attachments: refs,
        startIndex: startIndex >= 0 ? startIndex : 0,
      });
    },
    [attachments],
  );

  if (!attachments.length) {
    return null;
  }

  return (
    <div
      className={cn('flex flex-wrap gap-1', className)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      role='presentation'
      data-track-category={trackCategory}
      data-track-name='MESSAGE_CARD_ATTACHMENTS_STRIP'
    >
      {attachments.map(att => {
        if (isImageMime(att.mimetype)) {
          return (
            <button
              key={att.id}
              type='button'
              onClick={openViewer(att.id)}
              className='h-8 w-8 overflow-hidden rounded border border-border bg-muted shrink-0 focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring'
              aria-label={`View attachment ${att.originalFilename}`}
              data-track-category={trackCategory}
              data-track-name='MESSAGE_CARD_ATTACHMENT_OPEN_IMAGE'
            >
              <PanelAuthImageThumb
                attachmentId={att.id}
                mimeType={att.mimetype}
                thumbnailUrl={att.thumbnailUrl ?? null}
                className='h-full w-full'
              />
            </button>
          );
        }
        if (isVideoMime(att.mimetype)) {
          return (
            <button
              key={att.id}
              type='button'
              onClick={openViewer(att.id)}
              className='relative h-8 w-8 overflow-hidden rounded border border-border bg-muted shrink-0 flex items-center justify-center focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring'
              aria-label={`View video ${att.originalFilename}`}
              data-track-category={trackCategory}
              data-track-name='MESSAGE_CARD_ATTACHMENT_OPEN_VIDEO'
            >
              {att.thumbnailUrl ? (
                <PanelAuthImageThumb
                  attachmentId={att.id}
                  mimeType={att.mimetype}
                  thumbnailUrl={att.thumbnailUrl}
                  className='absolute inset-0 h-full w-full'
                />
              ) : (
                <Video className='h-4 w-4 text-muted-foreground' />
              )}
              <Play className='relative h-3 w-3 text-white drop-shadow-md' fill='currentColor' />
            </button>
          );
        }
        const { extension, label, badgeClassName, iconSrc } = getFileThumbMeta(att.mimetype);
        return (
          <button
            key={att.id}
            type='button'
            onClick={openViewer(att.id)}
            className='h-9 max-w-[150px] flex items-center gap-2 rounded-lg border border-border bg-background pl-1.5 pr-2.5 shrink-0 text-left hover:bg-muted/40 transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring'
            aria-label={`View file ${att.originalFilename}`}
            data-track-category={trackCategory}
            data-track-name='MESSAGE_CARD_ATTACHMENT_OPEN_FILE'
          >
            {iconSrc ? (
              <span className='h-5 w-5 shrink-0'>
                <img src={iconSrc} alt={label} className='h-full w-full object-contain' />
              </span>
            ) : (
              <span
                className={cn(
                  'h-5 w-5 rounded-md flex items-center justify-center flex-shrink-0 text-[9px] font-bold',
                  badgeClassName,
                )}
              >
                {extension.slice(0, 3)}
              </span>
            )}
            <span className='text-xs text-foreground/85 truncate max-w-[120px]'>
              {att.originalFilename}
            </span>
          </button>
        );
      })}
    </div>
  );
}
