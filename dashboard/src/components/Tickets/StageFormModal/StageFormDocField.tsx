import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useSelector } from '@xstate/react';
import { AttachmentPreview } from '../../ui/files/AttachmentPreview';
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
  // Persisted (claimed) attachment from the parent's getFormEntityValuesByEntityId
  // query, joined via the `attachments` relation on form_entity_values. Renders
  // the chat-style preview + click-to-open viewer when present.
  existingAttachment?: MessageAttachmentRow | undefined;
  // Called when the user picks a new file (provides File) or removes the
  // current selection (provides undefined). The parent tracks these and
  // uploads pending files at submit time — no DB writes happen here.
  onLocalChange: (file: File | undefined) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export const StageFormDocField: React.FC<StageFormDocFieldProps> = ({
  fieldId,
  existingAttachment,
  onLocalChange,
  disabled = false,
  readOnly = false,
}) => {
  // Local-only file state. No upload happens here — the file lives in memory
  // until the user clicks Submit in the parent modal, at which point the parent
  // POSTs it to /attachments/upload directly bound to a FormEntityValues row.
  const [localFile, setLocalFile] = useState<File | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Local file picked this session takes precedence — render its preview from
  // the browser File directly. No upload yet, so no MessageAttachment row.
  if (localFile) {
    return (
      <div className='space-y-2'>
        <AttachmentPreview
          file={localFile}
          onRemove={() => {
            if (!readOnly && !disabled) handleRemove();
          }}
          isUploading={false}
          variant='detailed'
        />
        {!readOnly && !disabled && (
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
        )}
        {hiddenInput}
      </div>
    );
  }

  // Persisted attachment from prior submission — chat-style preview with
  // click-to-open viewer (mirrors FileBubble's pattern).
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

export default StageFormDocField;
