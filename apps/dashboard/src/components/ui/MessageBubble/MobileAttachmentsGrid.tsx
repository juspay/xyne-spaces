import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Dialog } from '@base-ui/react/dialog';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import { isImageFile, isVideoFile } from '../../Chat/MessageAttachment/utils';
import { isPreviewableDocument } from '../../../services/documentThumbnailService';

type Attachment = QueryResultType<
  typeof queries.conversationMessagesV2
>[number]['attachments'][number];

interface MobileAttachmentsGridProps {
  readonly attachments: readonly Attachment[];
  conversationId?: string;
  channelId?: string;
}

const formatAttachmentSummary = (attachments: readonly Attachment[]): string => {
  let photos = 0;
  let videos = 0;
  let files = 0;

  for (const att of attachments) {
    // Skip soft-deleted attachments from the summary count
    if ((att as { isDeleted?: boolean }).isDeleted) continue;
    if (isImageFile(att.mimetype)) {
      photos++;
    } else if (isVideoFile(att.mimetype)) {
      videos++;
    } else {
      files++;
    }
  }

  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} ${photos === 1 ? 'Photo' : 'Photos'}`);
  if (videos > 0) parts.push(`${videos} ${videos === 1 ? 'Video' : 'Videos'}`);
  if (files > 0) parts.push(`${files} ${files === 1 ? 'File' : 'Files'}`);

  return parts.join(', ');
};

export const MobileAttachmentsGrid: React.FC<MobileAttachmentsGridProps> = ({ attachments }) => {
  const [showAll, setShowAll] = useState(false);

  if (attachments.length === 0) {
    return null;
  }

  // Separate active (non-deleted) from soft-deleted attachments
  const activeAttachments = attachments.filter(a => !(a as { isDeleted?: boolean }).isDeleted);
  const deletedAttachments = attachments.filter(a => (a as { isDeleted?: boolean }).isDeleted);

  const handleOpenAll = (): void => {
    setShowAll(true);
  };

  const handleClose = (): void => {
    setShowAll(false);
  };

  return (
    <>
      {/* Active attachments grid */}
      {activeAttachments.length > 0 &&
        (() => {
          // For single attachment
          if (activeAttachments.length === 1) {
            const attachment = activeAttachments[0]!;
            const isMedia = isImageFile(attachment.mimetype) || isVideoFile(attachment.mimetype);
            const isDocument = isPreviewableDocument(attachment.mimetype);
            return (
              <div
                className={`w-full ${isDocument ? 'h-[220px] min-w-[75vw]' : !isMedia ? 'h-[256px] min-w-[256px] aspect-square' : ''}`}
              >
                <MessageAttachment attachment={attachment} allAttachments={attachments} isInGrid />
              </div>
            );
          }

          // For 2 attachments
          if (activeAttachments.length === 2) {
            return (
              <div className='grid grid-cols-2 row-span-2 gap-1'>
                {activeAttachments.map(attachment => (
                  <div key={attachment.id} className='h-full min-h-[256px]'>
                    <MessageAttachment
                      attachment={attachment}
                      allAttachments={attachments}
                      isInGrid
                    />
                  </div>
                ))}
              </div>
            );
          }

          // For 3 attachments
          if (activeAttachments.length === 3) {
            return (
              <div className='grid grid-cols-2 first:*:row-span-2 first:*:w-full gap-1 overflow-hidden'>
                {activeAttachments.map(attachment => (
                  <div key={attachment.id} className='h-full aspect-square'>
                    <MessageAttachment
                      attachment={attachment}
                      allAttachments={attachments}
                      isInGrid
                    />
                  </div>
                ))}
              </div>
            );
          }

          // For 4+ attachments: 2x2 grid with +N overlay
          const visibleAttachments = activeAttachments.slice(0, 4);
          const hasMore = activeAttachments.length > 4;
          const remainingCount = activeAttachments.length - 3;

          return (
            <>
              <div className='grid grid-cols-2 gap-1'>
                {visibleAttachments.map((attachment, index) => (
                  <div key={attachment.id} className='relative aspect-square'>
                    <MessageAttachment
                      attachment={attachment}
                      allAttachments={attachments}
                      isInGrid
                    />
                    {hasMore && index === 3 && (
                      <button
                        type='button'
                        onClick={handleOpenAll}
                        data-track-category='MESSAGE'
                        data-track-name='OPEN_ALL_ATTACHMENTS'
                        className='absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg'
                      >
                        <span className='text-white text-2xl font-semibold'>+{remainingCount}</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Vertical list modal */}
              <Dialog.Root open={showAll} onOpenChange={handleClose}>
                <Dialog.Portal>
                  <Dialog.Backdrop
                    className='fixed inset-0 bg-background z-50'
                    style={{ touchAction: 'none' }}
                    onPointerDown={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                    data-prevent-drawer='true'
                  />
                  <Dialog.Popup
                    className='fixed inset-0 z-50 flex flex-col'
                    style={{ touchAction: 'none' }}
                    data-prevent-drawer='true'
                  >
                    <div
                      className='flex items-center justify-between px-4 py-3 border-b'
                      onPointerDown={e => e.stopPropagation()}
                      onTouchStart={e => e.stopPropagation()}
                    >
                      <span className='font-medium text-sm'>
                        {formatAttachmentSummary(attachments)}
                      </span>
                      <button
                        type='button'
                        onClick={handleClose}
                        data-track-category='MESSAGE'
                        data-track-name='CLOSE_ATTACHMENTS_GRID'
                        className='p-2'
                      >
                        <X className='w-6 h-6' />
                      </button>
                    </div>
                    <div className='flex-1 overflow-y-auto divide-y'>
                      {activeAttachments.map(att => (
                        <div key={att.id} className='p-2'>
                          <MessageAttachment
                            attachment={att}
                            allAttachments={attachments}
                            fullSize
                          />
                        </div>
                      ))}
                    </div>
                  </Dialog.Popup>
                </Dialog.Portal>
              </Dialog.Root>
            </>
          );
        })()}

      {/* Single deleted attachment tombstone — shown only when ALL attachments in the message are deleted */}
      {deletedAttachments.length > 0 && activeAttachments.length === 0 && (
        <div className='mt-1'>
          <div className='flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2'>
            <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted'>
              <Trash2 className='h-4 w-4 text-muted-foreground' />
            </div>
            <span className='text-sm text-muted-foreground'>This file was deleted.</span>
          </div>
        </div>
      )}
    </>
  );
};
