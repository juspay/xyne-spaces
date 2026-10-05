import { ReactElement, useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { apiInstance } from '../../../services/clients/apiClient';
import { downloadFile, fetchFile } from '../../../services/clients/fileFetchService';
import { cn } from '../../../utils/classNames';
import { createMarkdownComponents } from '../../../utils/markdownComponents';

export type CallTranscriptionStatus = 'queued' | 'processing' | 'done' | 'failed';

/** `transcription` key the backend writes into the call email's JSON body. */
export interface CallTranscriptionState {
  status: CallTranscriptionStatus;
  error?: string;
  attachmentId?: string;
  /** AI summary (Markdown), written by the backend after the transcript. */
  summary?: string;
  updatedAt?: string;
}

/** Subset of the Zero `messageAttachments` row the call card needs. */
export interface CallThreadAttachment {
  id: string;
  /** Nullable on the rows the Slack/App and email desk threads carry. */
  originalFilename?: string | null | undefined;
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
  const rawSummary = raw['summary'];
  const rawUpdatedAt = raw['updatedAt'];
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (!TRANSCRIPTION_STATUSES.has(status)) return undefined;
  return {
    status: status as CallTranscriptionStatus,
    ...(typeof rawError === 'string' && rawError.trim() ? { error: rawError.trim() } : {}),
    ...(typeof rawAttachmentId === 'string' ? { attachmentId: rawAttachmentId } : {}),
    ...(typeof rawSummary === 'string' && rawSummary.trim() ? { summary: rawSummary.trim() } : {}),
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

const DEFAULT_TRANSCRIPT_FILENAME = 'call-transcript.txt';

/** One job attempt is capped at 50 min on the backend; a queued/processing state older than this has lost its job. */
const STALE_IN_PROGRESS_MS = 60 * 60_000;
/** Zero can deliver the `done` body before the attachment row; a fresh `done` is still loading. */
const ATTACHMENT_SYNC_GRACE_MS = 60_000;

const stateAgeMs = (updatedAt: string | undefined): number => {
  const timestamp = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : Date.now() - timestamp;
};

/** `call-transcript-TXR9dcf5ba965…20260925.txt` style: keep the start and the tail, cap at ~20 chars. */
const shortFilename = (name: string, max = 20): string => {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const tail = dot > 0 ? name.slice(Math.max(dot - 4, 0)) : '';
  const head = name.slice(0, Math.max(max - tail.length - 1, 4));
  return `${head}…${tail}`;
};

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
        summary={transcription?.summary}
        emailId={emailId}
        ticketId={ticketId}
        rowClass={rowClass}
        buttonClass={buttonClass}
        isCompact={isCompact}
      />
    );
  }

  const status = transcription?.status;
  const ageMs = stateAgeMs(transcription?.updatedAt);
  // The job can vanish without a final state (queue flush, lost worker): offer Retry instead of
  // spinning forever. The backend answers 409 if a job is in fact still running.
  const isStale = (status === 'queued' || status === 'processing') && ageMs > STALE_IN_PROGRESS_MS;
  const isAwaitingAttachment = status === 'done' && ageMs < ATTACHMENT_SYNC_GRACE_MS;

  if (((status === 'queued' || status === 'processing') && !isStale) || isAwaitingAttachment) {
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
          {status === 'queued'
            ? 'Queued…'
            : status === 'processing'
              ? 'Transcribing…'
              : 'Loading transcript…'}
        </Button>
      </div>
    );
  }

  if (status === 'failed' || isStale) {
    return (
      <div className={rowClass}>
        <span className='flex min-w-0 items-center gap-1.5 text-xs text-destructive'>
          <AlertCircle className='size-3.5 shrink-0' />
          <span className='truncate'>
            {isStale
              ? 'Transcription did not finish'
              : (transcription?.error ?? 'Transcription failed')}
          </span>
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

function CallSummaryPanel({
  summary,
  attachmentId,
  buttonClass,
}: {
  summary: string;
  attachmentId: string;
  buttonClass: string;
}): ReactElement {
  const [open, setOpen] = useState(true);
  const markdownComponents = useMemo(
    () => createMarkdownComponents(`call-summary-${attachmentId}`),
    [attachmentId],
  );

  return (
    <div className='mt-2'>
      <div className='flex items-center gap-2'>
        <span className='flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
          <Sparkles className='size-3.5 shrink-0' />
          AI summary
        </span>
        <Button
          type='button'
          variant='ghost'
          size='inline'
          className={cn(buttonClass, 'ml-auto')}
          onClick={() => setOpen(prev => !prev)}
          aria-expanded={open}
          data-track-category='Support'
          data-track-name={open ? 'HideCallSummary' : 'ShowCallSummary'}
        >
          {open ? <ChevronUp className='size-3.5' /> : <ChevronDown className='size-3.5' />}
          {open ? 'Hide summary' : 'View summary'}
        </Button>
      </div>
      {open ? (
        <div className='mt-2 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-xs [&_h2]:font-semibold [&_h2:first-child]:mt-0 [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4 [&_p]:my-1'>
          <MarkdownMessageRenderer content={summary} markdownComponents={markdownComponents} />
        </div>
      ) : null}
    </div>
  );
}

function CallTranscriptViewer({
  attachment,
  summary,
  emailId,
  ticketId,
  rowClass,
  buttonClass,
  isCompact,
}: {
  attachment: CallThreadAttachment;
  summary?: string | undefined;
  emailId: string;
  ticketId: string;
  rowClass: string;
  buttonClass: string;
  isCompact: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Summary returned by the manual request, shown until Zero delivers the stored one.
  const [requestedSummary, setRequestedSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const effectiveSummary = summary ?? requestedSummary ?? undefined;
  const filename = attachment.originalFilename?.trim() || DEFAULT_TRANSCRIPT_FILENAME;

  const requestSummary = useCallback(async (): Promise<void> => {
    setSummarizing(true);
    try {
      const { data } = await apiInstance.post<{ summary: string }>(
        `/tickets/${encodeURIComponent(ticketId)}/emails/${encodeURIComponent(emailId)}/summarize`,
      );
      if (data?.summary) setRequestedSummary(data.summary);
    } catch (error) {
      toast.error(serverErrorMessage(error) ?? 'Failed to generate summary');
    } finally {
      setSummarizing(false);
    }
  }, [emailId, ticketId]);

  const loadTranscript = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const file = await fetchFile(attachment.id, filename, attachment.mimetype ?? 'text/plain');
      setText(await file.text());
    } catch {
      setLoadError('Failed to load transcript');
    } finally {
      setLoading(false);
    }
  }, [attachment.id, filename, attachment.mimetype]);

  const toggleOpen = (): void => {
    const next = !open;
    setOpen(next);
    if (next && text === null && !loading) void loadTranscript();
  };

  const handleDownload = (): void => {
    const toastId = toast.loading(`Downloading ${filename}…`);
    downloadFile(attachment.id, filename)
      .then(() => toast.success(`Downloaded ${filename}`, { id: toastId }))
      .catch(() => toast.error(`Failed to download ${filename}`, { id: toastId }));
  };

  return (
    <div className={isCompact ? 'mt-2' : 'mt-3'}>
      {/* File name is capped and ellipsised so the actions stay in a fixed column on the right. */}
      <div className={cn(rowClass, 'mt-0 flex-nowrap')}>
        <span className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
          <FileText className='size-3.5 shrink-0' />
          <span className='whitespace-nowrap' title={filename}>
            {shortFilename(filename)}
          </span>
        </span>
        <div className='ml-auto flex shrink-0 items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            size='inline'
            className={cn(buttonClass, 'px-2')}
            onClick={handleDownload}
            aria-label={`Download ${filename}`}
            title='Download transcript'
            data-track-category='Support'
            data-track-name='DownloadCallTranscript'
          >
            <Download className='size-3.5' />
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
          {!effectiveSummary ? (
            <Button
              type='button'
              variant='outline'
              size='inline'
              className={buttonClass}
              onClick={() => void requestSummary()}
              disabled={summarizing}
              data-track-category='Support'
              data-track-name='SummarizeCallTranscript'
            >
              {summarizing ? (
                <Loader2 className='size-3.5 animate-spin' />
              ) : (
                <Sparkles className='size-3.5' />
              )}
              {summarizing ? 'Summarizing…' : 'Summarize'}
            </Button>
          ) : null}
        </div>
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
      {effectiveSummary ? (
        <CallSummaryPanel
          summary={effectiveSummary}
          attachmentId={attachment.id}
          buttonClass={buttonClass}
        />
      ) : null}
    </div>
  );
}
