import { ReactElement, useCallback, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Download, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import { apiInstance } from '../../../services/clients/apiClient';
import { downloadFile, fetchFile } from '../../../services/clients/fileFetchService';
import { cn } from '../../../utils/classNames';

export type CallTranscriptionStatus = 'queued' | 'processing' | 'done' | 'failed';

/** `transcription` key the backend writes into the call email's JSON body. */
export interface CallTranscriptionState {
  status: CallTranscriptionStatus;
  error?: string;
  attachmentId?: string;
  updatedAt?: string;
}

/** Subset of the Zero `messageAttachments` row the call card needs. */
export interface CallThreadAttachment {
  id: string;
  originalFilename: string;
  mimetype?: string | null;
  metadata?: unknown;
  isDeleted?: boolean | null;
}

const TRANSCRIPTION_STATUSES: ReadonlySet<string> = new Set<CallTranscriptionStatus>([
  'queued',
  'processing',
  'done',
  'failed',
]);

/** Defensive parse of the raw `transcription` value from the call body. */
export function parseCallTranscriptionState(value: unknown): CallTranscriptionState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const rawStatus = raw['status'];
  const rawError = raw['error'];
  const rawAttachmentId = raw['attachmentId'];
  const rawUpdatedAt = raw['updatedAt'];
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (!TRANSCRIPTION_STATUSES.has(status)) return undefined;
  return {
    status: status as CallTranscriptionStatus,
    ...(typeof rawError === 'string' && rawError.trim() ? { error: rawError.trim() } : {}),
    ...(typeof rawAttachmentId === 'string' ? { attachmentId: rawAttachmentId } : {}),
    ...(typeof rawUpdatedAt === 'string' ? { updatedAt: rawUpdatedAt } : {}),
  };
}

/** Attachment `metadata` arrives as a JSON object from Zero, but tolerate a JSON string too. */
function parseAttachmentMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try {
      const parsed: unknown = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof metadata === 'object' ? (metadata as Record<string, unknown>) : null;
}

export function findCallTranscriptAttachment(
  attachments: ReadonlyArray<CallThreadAttachment> | undefined,
): CallThreadAttachment | undefined {
  return attachments?.find(
    att =>
      att.isDeleted !== true &&
      parseAttachmentMetadata(att.metadata)?.['type'] === 'call_transcript',
  );
}

const serverErrorMessage = (error: unknown): string | undefined => {
  const message = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof message === 'string' && message.trim() ? message : undefined;
};

interface CallTranscriptControlsProps {
  emailId: string;
  ticketId: string;
  attachments?: ReadonlyArray<CallThreadAttachment> | undefined;
  transcription?: CallTranscriptionState | undefined;
  hasRecording: boolean;
  variant: 'full' | 'compact';
}

/**
 * Transcribe / status / transcript row rendered under a call recording. All
 * state transitions are driven by live data: the button only POSTs, and Zero
 * pushes the updated `transcription` status and the transcript attachment.
 */
export function CallTranscriptControls({
  emailId,
  ticketId,
  attachments,
  transcription,
  hasRecording,
  variant,
}: CallTranscriptControlsProps): ReactElement | null {
  const transcriptAttachment = useMemo(
    () => findCallTranscriptAttachment(attachments),
    [attachments],
  );

  const requestTranscription = useCallback(async (): Promise<void> => {
    try {
      await apiInstance.post<{ status: string }>(
        `/tickets/${encodeURIComponent(ticketId)}/emails/${encodeURIComponent(emailId)}/transcribe`,
      );
      // 202 → nothing else to do; Zero pushes the `queued` status.
    } catch (error) {
      toast.error(serverErrorMessage(error) ?? 'Failed to start transcription');
    }
  }, [emailId, ticketId]);

  const isCompact = variant === 'compact';
  const rowClass = cn('flex flex-wrap items-center gap-2', isCompact ? 'mt-2' : 'mt-3');
  const buttonClass = isCompact ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-xs';

  if (transcriptAttachment) {
    return (
      <CallTranscriptViewer
        attachment={transcriptAttachment}
        rowClass={rowClass}
        buttonClass={buttonClass}
        isCompact={isCompact}
      />
    );
  }

  const status = transcription?.status;

  if (status === 'queued' || status === 'processing') {
    return (
      <div className={rowClass}>
        <Button
          type='button'
          variant='outline'
          size='inline'
          className={buttonClass}
          disabled
          data-track-category='Support'
          data-track-name='CallTranscriptionPending'
        >
          <Loader2 className='size-3.5 animate-spin' />
          {status === 'queued' ? 'Queued…' : 'Transcribing…'}
        </Button>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className={rowClass}>
        <span className='flex min-w-0 items-center gap-1.5 text-xs text-destructive'>
          <AlertCircle className='size-3.5 shrink-0' />
          <span className='truncate'>{transcription?.error ?? 'Transcription failed'}</span>
        </span>
        <Button
          type='button'
          variant='outline'
          size='inline'
          className={buttonClass}
          trackAction={requestTranscription}
          data-track-category='Support'
          data-track-name='RetryCallTranscription'
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!hasRecording) return null;

  return (
    <div className={rowClass}>
      <Button
        type='button'
        variant='outline'
        size='inline'
        className={buttonClass}
        trackAction={requestTranscription}
        data-track-category='Support'
        data-track-name='TranscribeCallRecording'
      >
        <FileText className='size-3.5' />
        Transcribe
      </Button>
    </div>
  );
}

function CallTranscriptViewer({
  attachment,
  rowClass,
  buttonClass,
  isCompact,
}: {
  attachment: CallThreadAttachment;
  rowClass: string;
  buttonClass: string;
  isCompact: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTranscript = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const file = await fetchFile(
        attachment.id,
        attachment.originalFilename,
        attachment.mimetype ?? 'text/plain',
      );
      setText(await file.text());
    } catch {
      setLoadError('Failed to load transcript');
    } finally {
      setLoading(false);
    }
  }, [attachment.id, attachment.originalFilename, attachment.mimetype]);

  const toggleOpen = (): void => {
    const next = !open;
    setOpen(next);
    if (next && text === null && !loading) void loadTranscript();
  };

  const handleDownload = (): void => {
    const toastId = toast.loading(`Downloading ${attachment.originalFilename}…`);
    downloadFile(attachment.id, attachment.originalFilename)
      .then(() => toast.success(`Downloaded ${attachment.originalFilename}`, { id: toastId }))
      .catch(() =>
        toast.error(`Failed to download ${attachment.originalFilename}`, { id: toastId }),
      );
  };

  return (
    <div className={isCompact ? 'mt-2' : 'mt-3'}>
      <div className={cn(rowClass, 'mt-0')}>
        <span className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
          <FileText className='size-3.5 shrink-0' />
          <span className='truncate' title={attachment.originalFilename}>
            {attachment.originalFilename}
          </span>
        </span>
        <Button
          type='button'
          variant='outline'
          size='inline'
          className={buttonClass}
          onClick={handleDownload}
          data-track-category='Support'
          data-track-name='DownloadCallTranscript'
        >
          <Download className='size-3.5' />
          Download
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='inline'
          className={buttonClass}
          onClick={toggleOpen}
          aria-expanded={open}
          data-track-category='Support'
          data-track-name={open ? 'HideCallTranscript' : 'ViewCallTranscript'}
        >
          {open ? <ChevronUp className='size-3.5' /> : <ChevronDown className='size-3.5' />}
          {open ? 'Hide transcript' : 'View transcript'}
        </Button>
      </div>
      {open ? (
        <div className='mt-2 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground'>
          {loading ? (
            <div className='flex items-center gap-2 text-muted-foreground'>
              <Loader2 className='size-3.5 animate-spin' />
              Loading transcript…
            </div>
          ) : loadError ? (
            <div className='flex flex-wrap items-center gap-2 text-destructive'>
              <span className='flex items-center gap-1.5'>
                <AlertCircle className='size-3.5 shrink-0' />
                {loadError}
              </span>
              <Button
                type='button'
                variant='outline'
                size='inline'
                className='h-6 px-2 text-xs'
                onClick={() => void loadTranscript()}
                data-track-category='Support'
                data-track-name='RetryLoadCallTranscript'
              >
                Retry
              </Button>
            </div>
          ) : (
            <pre className='max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words font-sans leading-relaxed'>
              {text?.trim() ? text : 'Transcript is empty'}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
