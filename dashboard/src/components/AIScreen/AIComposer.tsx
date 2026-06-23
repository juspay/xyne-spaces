import {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type FormEvent,
  type KeyboardEvent,
  type ClipboardEvent,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import { ArrowUp, Paperclip, Square, X, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { DANGEROUS_EXTENSIONS } from '@xyne/shared';
import { AIAgentSelector } from './AIAgentSelector';
import { cn } from '../../utils/classNames';

export interface AIComposerAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  data: string;
  mimeType: string;
  filename: string;
}

export interface AIComposerHandle {
  addFiles: (files: File[]) => void;
  clearContent: () => void;
  focus: () => void;
}

interface AIComposerProps {
  autoFocus?: boolean;
  onSubmit?: (text: string, attachments?: AIComposerAttachment[]) => void;
  placeholder?: string;
  hideDisclaimer?: boolean;
  pending?: boolean;
  onStop?: () => void;
  /** Forwarded to AIAgentSelector — fires when the user picks a different
   *  agent, so the parent can open a fresh chat for that agent. */
  onAgentChange?: ((slug: string | null) => void) | undefined;
}

// File attachment limits — kept in sync with claw-auth's run-stream
// rehydration caps (xyne-claw-auth/backend/src/routes/run-stream.ts).
// Without alignment, a user can attach a file that exceeds the backend
// caps and have it silently dropped from the agent's context in a
// follow-up turn.
const MAX_INDIVIDUAL_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25 MiB
const MAX_ATTACHMENTS = 20;
const LARGE_PASTE_THRESHOLD = 11500;

const blockedExtensions = new Set(DANGEROUS_EXTENSIONS.map(ext => ext.toLowerCase()));

const isValidBase64 = (str: string): boolean => {
  if (!str || str.length === 0) return false;
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str)) return false;
  if (str.length % 4 !== 0) return false;
  return true;
};

export const AIComposer = forwardRef<AIComposerHandle, AIComposerProps>(function AIComposer(
  {
    autoFocus,
    onSubmit,
    placeholder = 'Ask anything',
    pending = false,
    onStop,
    hideDisclaimer,
    onAgentChange,
  },
  ref,
): ReactElement {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<AIComposerAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect((): void => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${String(Math.min(el.scrollHeight, 200))}px`;
  }, [value]);

  useEffect((): void => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  const handleFilesAdded = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;

      const validFiles = files.filter(file => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        return !ext || !blockedExtensions.has(`.${ext}`);
      });

      if (validFiles.length === 0) {
        toast.error('The selected file type is not allowed for security reasons.', {
          duration: 3000,
        });
        return;
      }

      const oversizedFiles = validFiles.filter(file => file.size > MAX_INDIVIDUAL_FILE_SIZE);
      if (oversizedFiles.length > 0) {
        const fileNames = oversizedFiles.map(f => f.name).join(', ');
        toast.error(`File(s) too large: ${fileNames}. Maximum file size is 10MB.`, {
          duration: 4000,
        });
        return;
      }

      const remaining = MAX_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        toast.error(`Maximum ${MAX_ATTACHMENTS} attachments allowed.`, { duration: 3000 });
        return;
      }
      const allowedFiles = validFiles.slice(0, remaining);
      if (validFiles.length > remaining) {
        toast.error(`Maximum ${MAX_ATTACHMENTS} attachments allowed.`, { duration: 3000 });
      }

      const existingTotalSize = attachments.reduce((sum, att) => sum + att.size, 0);
      const newFilesSize = allowedFiles.reduce((sum, file) => sum + file.size, 0);
      if (existingTotalSize + newFilesSize > MAX_TOTAL_SIZE) {
        const totalMB = Math.round((existingTotalSize + newFilesSize) / (1024 * 1024));
        toast.error(
          `Total attachment size (${totalMB}MB) exceeds the 25MB limit. Please remove some attachments.`,
          { duration: 4000 },
        );
        return;
      }

      const filePromises = allowedFiles.map(
        file =>
          new Promise<AIComposerAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (): void => {
              const result = reader.result as string;
              const base64Match = result.match(/^data:([^;]+);base64,(.+)$/);
              if (!base64Match) {
                reject(
                  new Error(`Invalid file format - not a valid data URL for file: ${file.name}`),
                );
                return;
              }
              const [, , base64Data] = base64Match;
              if (!base64Data) {
                reject(new Error(`Empty file data for file: ${file.name}`));
                return;
              }
              if (!isValidBase64(base64Data)) {
                reject(new Error(`Invalid base64 data for file: ${file.name}`));
                return;
              }
              resolve({
                id: `${file.name}-${Date.now()}-${Math.random()}`,
                name: file.name,
                size: file.size,
                type: file.type,
                file,
                data: base64Data,
                mimeType: file.type,
                filename: file.name,
              });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          }),
      );

      try {
        const newAttachments = await Promise.all(filePromises);
        setAttachments(prev => [...prev, ...newAttachments]);
        if (newAttachments.length > 1) {
          toast.success(`${newAttachments.length} files attached successfully`, { duration: 2000 });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Error reading files. Please try again.';
        toast.error(errorMessage, { duration: 3000 });
      }
    },
    [attachments],
  );

  useImperativeHandle(
    ref,
    () => ({
      addFiles: (files: File[]): void => {
        if (files.length > 0) {
          void handleFilesAdded(files);
        }
      },
      clearContent: (): void => {
        setValue('');
        setAttachments([]);
      },
      focus: (): void => {
        textareaRef.current?.focus();
      },
    }),
    [handleFilesAdded],
  );

  const submit = (): void => {
    if (pending) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit?.(trimmed, attachments.length > 0 ? attachments : undefined);
    setValue('');
    setAttachments([]);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const clipboard = e.clipboardData;
    const files = clipboard?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      void handleFilesAdded(Array.from(files));
      return;
    }

    const pastedText = clipboard?.getData('text');
    if (pastedText && pastedText.length > LARGE_PASTE_THRESHOLD) {
      e.preventDefault();
      if (attachments.length >= MAX_ATTACHMENTS) {
        toast.error(`Maximum ${MAX_ATTACHMENTS} attachments allowed.`, { duration: 3000 });
        return;
      }
      let fileName: string;
      let fileType: string;
      try {
        JSON.parse(pastedText);
        fileName = `pasted-text-${Date.now()}.json`;
        fileType = 'application/json';
      } catch {
        fileName = `pasted-text-${Date.now()}.txt`;
        fileType = 'text/plain';
      }
      const blob = new Blob([pastedText], { type: fileType });
      const file = new File([blob], fileName, { type: fileType });
      void handleFilesAdded([file]);
    }
  };

  const handleAttachClick = (): void => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void handleFilesAdded(Array.from(files));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (attachmentId: string): void => {
    setAttachments(prev => prev.filter(att => att.id !== attachmentId));
  };

  const canSend = value.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className='relative'>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        onChange={handleFileInputChange}
        className='hidden'
        aria-label='Upload files'
      />
      <div
        className={cn(
          'ai-composer-wrapper group flex flex-col gap-1 rounded-3xl border border-[#c0bcb4] bg-[#f5f4f0] px-3 pb-2 pt-3 transition shadow-[0_1px_0_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.08)] focus-within:border-[#a09c94] focus-within:shadow-[0_1px_0_rgba(0,0,0,0.1),0_12px_30px_-12px_rgba(0,0,0,0.12)]',
        )}
      >
        {attachments.length > 0 && (
          <div className='flex flex-wrap items-center gap-1.5 px-1 pb-1'>
            {attachments.map(attachment => (
              <div
                key={attachment.id}
                className='flex h-7 items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-2 py-1'
              >
                <FileText className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />
                <span className='max-w-[140px] truncate text-[12.5px] font-medium text-foreground'>
                  {attachment.name}
                </span>
                <button
                  type='button'
                  onClick={() => handleRemoveAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
                  className='ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground transition hover:bg-secondary hover:text-foreground'
                  data-track-category='XyneAI'
                  data-track-name='REMOVE_ATTACHMENT'
                >
                  <X className='h-3 w-3' aria-hidden strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={1}
          className='min-h-[60px] resize-none bg-transparent px-2 py-1 text-[15px] leading-6 placeholder:text-muted-foreground/80 focus:outline-none'
          data-track-category='XyneAI'
          data-track-name='ComposerInput'
        />

        <div className='flex items-center justify-between gap-2'>
          <button
            type='button'
            onClick={handleAttachClick}
            aria-label='Attach file'
            title='Attach'
            className='inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground'
            data-track-category='XyneAI'
            data-track-name='ATTACH_FILE'
          >
            <Paperclip className='h-4 w-4' aria-hidden strokeWidth={1.75} />
          </button>

          <div className='flex items-center gap-3'>
            <AIAgentSelector disabled={pending} onAgentChange={onAgentChange} />

            {pending ? (
              <button
                type='button'
                onClick={onStop}
                aria-label='Stop generating'
                title='Stop'
                className='inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90'
                data-track-category='XyneAI'
                data-track-name='STOP_GENERATION'
              >
                <Square className='h-2.5 w-2.5 fill-current' aria-hidden strokeWidth={0} />
              </button>
            ) : (
              <button
                type='submit'
                disabled={!canSend}
                aria-label='Send'
                title='Send'
                className={cn(
                  'ai-send-btn inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e8e4dd] text-foreground transition enabled:hover:bg-[#ddd9d2] disabled:cursor-not-allowed disabled:bg-[#e8e4dd]/50 disabled:text-muted-foreground',
                )}
              >
                <ArrowUp className='h-4 w-4' aria-hidden strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
      </div>
      {hideDisclaimer ? null : (
        <p className='mt-2 text-center text-[11px] text-muted-foreground/80'>
          Xyne can make mistakes. Verify important details.
        </p>
      )}
    </form>
  );
});
