import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, Spinner as Loader2 } from '@xyne/icons';
import { useSelector } from '@xstate/react';
import { FormFieldType } from '@xyne/shared';
import type { MessageAttachment as MessageAttachmentRow } from '@xyne/shared';
import Button from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import MessageAttachment from '../../Chat/MessageAttachment/MessageAttachment';
import { MediaViewer } from '../../ui/files/MediaViewer';
import {
  attachmentViewerActor,
  type AttachmentRef,
  type AttachmentViewerState,
} from '../../../machines/attachmentViewerMachine';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import type { ConflictResolution, StageFormFieldConflict } from '../StageFormFields/useStageForm';

interface StageFormConflictDialogProps {
  open: boolean;
  conflicts: readonly StageFormFieldConflict[];
  resolution: Map<string, ConflictResolution>;
  isConfirming: boolean;
  onChange: (fieldId: string, choice: ConflictResolution) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const looksLikeAttachmentId = (value: string): boolean =>
  /^c[a-z0-9]{20,}$/i.test(value) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const formatValue = (fieldType: FormFieldType, value: readonly string[]): string => {
  if (value.length === 0 || value.every(item => item.length === 0)) return 'Empty';
  if (fieldType === FormFieldType.BOOLEAN) return value[0] === 'true' ? 'Yes' : 'No';
  return value.join(', ');
};

const openPreview = (att: MessageAttachmentRow): void => {
  const ref: AttachmentRef = {
    attachmentId: att.id,
    fileName: att.originalFilename,
    fileUrl: `/attachments/${att.id}/download`,
    mimeType: att.mimetype,
    fileSize: att.size,
    thumbnailUrl: att.thumbnailUrl,
  };
  attachmentViewerActor.send({ type: 'OPEN', attachments: [ref], startIndex: 0 });
};

const FileCard = ({ att }: { att: MessageAttachmentRow }): React.JSX.Element => (
  <button
    type='button'
    onClick={event => {
      event.stopPropagation();
      openPreview(att);
    }}
    className='flex w-full items-center gap-2 rounded-md border border-border bg-card p-2 text-left transition hover:bg-accent'
    data-track-category='Tickets'
    data-track-name='StageFormConflictOpenFile'
  >
    <div className='pointer-events-none'>
      <MessageAttachment attachment={att} compact={true} />
    </div>
    <span className='min-w-0 truncate text-sm text-foreground'>{att.originalFilename}</span>
  </button>
);

const LocalFilePreview = ({
  file,
  onViewerOpenChange,
}: {
  file: File;
  onViewerOpenChange: (open: boolean) => void;
}): React.JSX.Element => {
  const [url, setUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <>
      <button
        type='button'
        onClick={event => {
          event.stopPropagation();
          setViewerOpen(true);
          onViewerOpenChange(true);
        }}
        className='flex w-full items-center gap-2 rounded-md border border-border bg-card p-2 text-left transition hover:bg-accent'
        data-track-category='Tickets'
        data-track-name='StageFormConflictOpenLocalFile'
      >
        {url ? (
          <img src={url} alt={file.name} className='h-16 w-16 shrink-0 rounded-md object-cover' />
        ) : (
          <div className='flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted'>
            <FileText size={20} className='text-muted-foreground' />
          </div>
        )}
        <span className='min-w-0 truncate text-sm text-foreground'>{file.name}</span>
      </button>
      <MediaViewer
        file={file}
        isOpen={viewerOpen}
        onClose={() => {
          setViewerOpen(false);
          onViewerOpenChange(false);
        }}
      />
    </>
  );
};

export const StageFormConflictDialog: React.FC<StageFormConflictDialogProps> = ({
  open,
  conflicts,
  resolution,
  isConfirming,
  onChange,
  onCancel,
  onConfirm,
}) => {
  const attachmentIds = useMemo(() => {
    const ids = new Set<string>();
    conflicts.forEach(conflict => {
      if (conflict.fieldType !== FormFieldType.DOC) return;
      [...conflict.theirs, ...conflict.mine].forEach(value => {
        if (value && looksLikeAttachmentId(value)) ids.add(value);
      });
    });
    return Array.from(ids);
  }, [conflicts]);

  const [attachments] = useCachedQuery(queries.attachmentsByIds({ attachmentIds }), {
    enabled: attachmentIds.length > 0,
  });

  const attachmentById = useMemo(() => {
    const rows = Array.isArray(attachments) ? attachments : [];
    return new Map(rows.map(row => [row.id, row]));
  }, [attachments]);

  const hasDocConflict = conflicts.some(conflict => conflict.fieldType === FormFieldType.DOC);

  const isGlobalViewerOpen = useSelector(
    attachmentViewerActor,
    (state: AttachmentViewerState) => state.value !== 'closed',
  );
  const [localViewerCount, setLocalViewerCount] = useState(0);
  const anyPreviewOpen = isGlobalViewerOpen || localViewerCount > 0;

  const renderSide = (
    conflict: StageFormFieldConflict,
    side: ConflictResolution,
  ): React.ReactNode => {
    if (conflict.fieldType !== FormFieldType.DOC) {
      return (
        <p className='text-sm text-foreground'>
          {formatValue(conflict.fieldType, side === 'theirs' ? conflict.theirs : conflict.mine)}
        </p>
      );
    }

    if (side === 'mine') {
      const change = conflict.localDocChange;
      if (change && 'file' in change) {
        return (
          <LocalFilePreview
            file={change.file}
            onViewerOpenChange={next =>
              setLocalViewerCount(count => Math.max(0, count + (next ? 1 : -1)))
            }
          />
        );
      }
      if (change && 'removed' in change)
        return <p className='text-sm text-foreground'>Removed file</p>;
    }

    const attachmentId = (side === 'theirs' ? conflict.theirs : conflict.mine)[0];
    const att = attachmentId ? attachmentById.get(attachmentId) : undefined;
    if (att) return <FileCard att={att} />;
    return <p className='text-sm text-foreground'>Empty</p>;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next && !isConfirming) onCancel();
      }}
      onEscapeKeyDown={event => {
        if (anyPreviewOpen) event.preventDefault();
      }}
      onPointerDownOutside={event => {
        if (anyPreviewOpen) event.preventDefault();
      }}
      title='Review form changes'
      className='max-w-2xl'
    >
      <div className='p-6'>
        <div className='mb-5 flex items-start gap-3'>
          <div className='mt-0.5 rounded-md bg-amber-100 p-2 text-amber-700'>
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2 className='text-lg font-semibold text-foreground'>Review form changes</h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              These fields changed after you started editing. Pick which value to keep for each.
            </p>
          </div>
        </div>

        <div className='max-h-[50vh] space-y-3 overflow-y-auto pr-1'>
          {conflicts.map(conflict => {
            const choice = resolution.get(conflict.fieldId) ?? 'theirs';
            return (
              <div
                key={conflict.fieldId}
                className='rounded-md border border-border bg-muted/30 p-3'
              >
                <p className='mb-2 text-sm font-medium text-foreground'>{conflict.fieldName}</p>
                <div className='grid gap-2 sm:grid-cols-2'>
                  {(['theirs', 'mine'] as const).map(side => (
                    <button
                      key={side}
                      type='button'
                      aria-pressed={choice === side}
                      onClick={() => !isConfirming && onChange(conflict.fieldId, side)}
                      disabled={isConfirming}
                      data-track-category='Tickets'
                      data-track-name='StageFormConflictChoice'
                      data-track-metadata={JSON.stringify({
                        fieldId: conflict.fieldId,
                        choice: side,
                      })}
                      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                        choice === side
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-background hover:bg-muted'
                      }`}
                    >
                      <p className='mb-1 text-xs font-medium text-muted-foreground'>
                        {side === 'theirs' ? 'Latest saved' : 'Your value'}
                      </p>
                      {renderSide(conflict, side)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {hasDocConflict && (
          <p className='mt-3 text-xs text-muted-foreground'>
            Keeping your value for a file field replaces and deletes the latest saved file.
          </p>
        )}

        <div className='mt-6 flex items-center justify-end gap-3 border-t border-border pt-4'>
          <Button
            variant='outline'
            onClick={onCancel}
            disabled={isConfirming}
            data-track-category='Tickets'
            data-track-name='CancelStageFormConflict'
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isConfirming}
            data-track-category='Tickets'
            data-track-name='ApplyStageFormConflict'
          >
            {isConfirming && <Loader2 size={16} className='animate-spin' />}
            Apply &amp; save
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
