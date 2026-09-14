import { useRef, useState } from 'react';
import { Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../../utils/classNames';
import {
  releaseAutomationTemplate,
  uploadAutomationTemplates,
  type AutomationTemplateAttachment,
} from '../../../../api/automationsApi';

const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

interface FileAttachmentsFieldProps {
  stepId: string;
  value: AutomationTemplateAttachment[];
  onChange: (next: AutomationTemplateAttachment[]) => void;
  readOnly?: boolean;
}

/**
 * Files sent exactly as uploaded, of any type. TemplateAttachmentsField is the
 * text-template sibling; its editor, preview and variable picker only make sense
 * for a file whose bytes are UTF-8 text, so binaries get this plainer field.
 */
export function FileAttachmentsField({
  stepId,
  value,
  onChange,
  readOnly = false,
}: FileAttachmentsFieldProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const addFiles = async (incoming: File[]): Promise<void> => {
    const error = validateFiles(incoming, value);
    if (error) {
      toast.error(error);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadAutomationTemplates(stepId, incoming);
      onChange([...value, ...uploaded]);
      toast.success(uploaded.length === 1 ? 'File attached' : `${uploaded.length} files attached`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'File upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = (attachment: AutomationTemplateAttachment): void => {
    onChange(value.filter(file => file.attachmentId !== attachment.attachmentId));
    releaseAutomationTemplate(attachment.attachmentId).catch(error => {
      toast.error(error instanceof Error ? error.message : 'Could not release the file');
    });
  };

  return (
    <div className='flex flex-col gap-2'>
      {value.length > 0 ? (
        <div
          className='overflow-hidden rounded-md border border-border'
          data-testid='automation-file-attachments'
        >
          {value.map((attachment, index) => (
            <div
              key={attachment.attachmentId}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5',
                index > 0 && 'border-t border-border',
              )}
            >
              <div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300'>
                <Paperclip className='size-4' />
              </div>
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium text-foreground'>
                  {attachment.originalFilename}
                </div>
                <div className='flex items-center gap-2 text-[11px] text-muted-foreground'>
                  <span>{formatBytes(attachment.size)}</span>
                  {/* Only .txt/.md/.html are templated, so this badge is the
                      per-file proof of which rule a given upload landed under. */}
                  {attachment.templatePaths.length > 0 ? (
                    <span className='rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300'>
                      {attachment.templatePaths.length} variable
                      {attachment.templatePaths.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>
              </div>
              {!readOnly ? (
                <button
                  type='button'
                  data-track-category='automation-builder'
                  data-track-name='email-attachment-remove'
                  aria-label='Remove file'
                  title='Remove file'
                  onClick={() => remove(attachment)}
                  className='flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
                >
                  <Trash2 className='size-3.5' />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!readOnly && value.length < MAX_FILES ? (
        <button
          type='button'
          data-track-category='automation-builder'
          data-track-name='email-attachment-upload'
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          onDragEnter={event => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={event => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={event => {
            event.preventDefault();
            setDragging(false);
            void addFiles(Array.from(event.dataTransfer.files));
          }}
          className={cn(
            'flex min-h-20 items-center justify-center gap-3 rounded-md border border-dashed px-4 py-3 text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
            dragging
              ? 'border-sky-500 bg-sky-500/10 text-foreground'
              : 'border-border text-muted-foreground hover:border-foreground/30 hover:bg-accent/30',
          )}
        >
          {uploading ? <Loader2 className='size-4 animate-spin' /> : <Upload className='size-4' />}
          <span className='flex flex-col'>
            <span className='text-sm font-medium text-foreground'>
              {uploading ? 'Uploading files…' : 'Upload files'}
            </span>
            <span className='text-[11px]'>Choose or drop any file, up to 10MB each</span>
          </span>
        </button>
      ) : null}
      <input
        ref={inputRef}
        className='hidden'
        type='file'
        multiple
        onChange={event => void addFiles(Array.from(event.target.files ?? []))}
      />
    </div>
  );
}

function validateFiles(incoming: File[], existing: AutomationTemplateAttachment[]): string | null {
  if (incoming.length === 0) return 'Choose at least one file';
  if (existing.length + incoming.length > MAX_FILES) return `Maximum ${MAX_FILES} files allowed`;
  for (const file of incoming) {
    if (file.size > MAX_FILE_BYTES) return `${file.name}: maximum file size is 10MB`;
  }
  const total =
    existing.reduce((sum, file) => sum + file.size, 0) +
    incoming.reduce((sum, file) => sum + file.size, 0);
  return total > MAX_TOTAL_BYTES ? 'Total attachment size cannot exceed 25MB' : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
