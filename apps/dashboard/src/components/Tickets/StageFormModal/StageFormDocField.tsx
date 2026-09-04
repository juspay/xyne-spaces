import React, { useEffect, useRef, useState } from 'react';
import { FileText, UploadUp as Upload } from '@xyne/icons';
import { useSelector } from '@xstate/react';
import { MediaViewer } from '../../ui/files/MediaViewer';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import {
  attachmentViewerActor,
  type AttachmentRef,
  type AttachmentViewerState,
} from '../../../machines/attachmentViewerMachine';
import type { MessageAttachment as MessageAttachmentRow } from '@xyne/shared';
import Button from '../../ui/Button';

interface StageFormDocFieldProps {
  fieldId: string;
  existingAttachment?: MessageAttachmentRow | undefined;
  existingAttachmentId?: string | undefined;
  onLocalChange: (file: File | undefined) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export const StageFormDocField: React.FC<StageFormDocFieldProps> = ({
  fieldId,
  existingAttachment,
  existingAttachmentId,
  onLocalChange,
  disabled = false,
  readOnly = false,
}) => {
  const [localFile, setLocalFile] = useState<File | undefined>();
  const [localFileUrl, setLocalFileUrl] = useState<string | null>(null);
  const [localViewerOpen, setLocalViewerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!localFile || !localFile.type.startsWith('image/')) {
      setLocalFileUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(localFile);
    setLocalFileUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [localFile]);

  const isViewerOpen = useSelector(
    attachmentViewerActor,
    (state: AttachmentViewerState) => state.value !== 'closed',
  );

  const handleSelect = (file: File): void => {
    setLocalFile(file);
    onLocalChange(file);
  };

  const handleRemove = (): void => {
    setLocalFile(undefined);
    onLocalChange(undefined);
  };

  const handlePreviewClick = (att: MessageAttachmentRow): void => {
    const ref: AttachmentRef = {
      attachmentId: att.id,
      fileName: att.originalFilename,
      fileUrl: `/attachments/${att.id}/download`,
      mimeType: att.mimetype,
      fileSize: att.size,
      thumbnailUrl: att.thumbnailUrl,
    };
    attachmentViewerActor.send({
      type: isViewerOpen ? 'UPDATE' : 'OPEN',
      attachments: [ref],
      startIndex: 0,
    });
  };

  const openPicker = (): void => fileInputRef.current?.click();

  const hiddenInput = (
    <input
      type='file'
      ref={fileInputRef}
      className='hidden'
      onChange={e => {
        const file = e.target.files?.[0];
        if (file) handleSelect(file);
        e.target.value = '';
      }}
      data-track-category='Tickets'
      data-track-name='StageFormDocFieldPick'
      data-track-metadata={JSON.stringify({ fieldId })}
    />
  );

  if (localFile) {
    return (
      <div className='space-y-2'>
        <button
          type='button'
          className='w-full text-left p-3 bg-card hover:bg-accent rounded-xl border border-border shadow-sm transition cursor-pointer'
          onClick={() => setLocalViewerOpen(true)}
          data-track-category='Tickets'
          data-track-name='StageFormDocFieldOpenLocalPreview'
          data-track-metadata={JSON.stringify({ fieldId })}
        >
          <div className='flex items-center gap-3'>
            {localFileUrl ? (
              <img
                src={localFileUrl}
                alt={localFile.name}
                className='h-16 w-16 shrink-0 rounded-md object-cover'
              />
            ) : (
              <div className='flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted'>
                <FileText size={20} className='text-muted-foreground' />
              </div>
            )}
            <div className='flex flex-col min-w-0'>
              <span className='font-medium text-sm text-foreground truncate'>{localFile.name}</span>
              <span className='text-xs text-muted-foreground'>{localFile.type || 'Document'}</span>
            </div>
          </div>
        </button>
        {!readOnly && !disabled && (
          <div className='flex gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={openPicker}
              data-track-category='Tickets'
              data-track-name='StageFormDocFieldReplace'
              data-track-metadata={JSON.stringify({ fieldId })}
            >
              Replace document
            </Button>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleRemove}
              data-track-category='Tickets'
              data-track-name='StageFormDocFieldRemoveLocal'
              data-track-metadata={JSON.stringify({ fieldId })}
            >
              Remove
            </Button>
          </div>
        )}
        <MediaViewer
          file={localFile}
          isOpen={localViewerOpen}
          onClose={() => setLocalViewerOpen(false)}
        />
        {hiddenInput}
      </div>
    );
  }

  if (existingAttachment) {
    return (
      <div className='space-y-2'>
        <button
          type='button'
          className='w-full text-left p-3 bg-card hover:bg-accent rounded-xl border border-border shadow-sm transition cursor-pointer'
          onClick={() => handlePreviewClick(existingAttachment)}
          data-track-category='Tickets'
          data-track-name='StageFormDocFieldOpenPreview'
          data-track-metadata={JSON.stringify({ fieldId })}
        >
          <div className='flex items-center gap-3'>
            <div className='pointer-events-none'>
              <MessageAttachment attachment={existingAttachment} compact={true} />
            </div>
            <div className='flex flex-col min-w-0'>
              <span className='font-medium text-sm text-foreground truncate'>
                {existingAttachment.originalFilename}
              </span>
              <span className='text-xs text-muted-foreground'>
                {existingAttachment.mimetype || 'Document'}
              </span>
            </div>
          </div>
        </button>
        {!readOnly && !disabled && (
          <div className='flex gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={openPicker}
              data-track-category='Tickets'
              data-track-name='StageFormDocFieldReplace'
              data-track-metadata={JSON.stringify({ fieldId })}
            >
              Replace document
            </Button>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleRemove}
              data-track-category='Tickets'
              data-track-name='StageFormDocFieldRemovePersisted'
              data-track-metadata={JSON.stringify({ fieldId })}
            >
              Remove
            </Button>
          </div>
        )}
        {hiddenInput}
      </div>
    );
  }

  if (existingAttachmentId) {
    return (
      <div className='space-y-2'>
        <div className='w-full rounded-xl border border-border bg-card p-3 text-left shadow-sm'>
          <div className='flex items-center gap-3'>
            <FileText size={18} className='shrink-0 text-muted-foreground' />
            <div className='flex min-w-0 flex-col'>
              <span className='truncate text-sm font-medium text-foreground'>
                Uploaded document
              </span>
              <span className='truncate text-xs text-muted-foreground'>
                Loading file details...
              </span>
            </div>
          </div>
        </div>
        {!readOnly && !disabled && (
          <div className='flex gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={openPicker}
              data-track-category='Tickets'
              data-track-name='StageFormDocFieldReplace'
              data-track-metadata={JSON.stringify({ fieldId })}
            >
              Replace document
            </Button>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleRemove}
              data-track-category='Tickets'
              data-track-name='StageFormDocFieldRemovePersisted'
              data-track-metadata={JSON.stringify({ fieldId })}
            >
              Remove
            </Button>
          </div>
        )}
        {hiddenInput}
      </div>
    );
  }

  if (readOnly || disabled) {
    return <div className='text-sm text-muted-foreground italic'>No document uploaded</div>;
  }

  return (
    <>
      <button
        type='button'
        onClick={openPicker}
        className='w-full border-2 border-dashed border-border rounded-lg p-6 text-center hover:bg-muted/50 transition-colors'
        data-track-category='Tickets'
        data-track-name='StageFormDocFieldOpenPicker'
        data-track-metadata={JSON.stringify({ fieldId })}
      >
        <Upload size={24} className='mx-auto mb-2 text-muted-foreground' />
        <p className='text-sm text-muted-foreground'>Click to upload document</p>
      </button>
      {hiddenInput}
    </>
  );
};
