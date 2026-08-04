import { type ReactElement, useEffect, useState } from 'react';
import { FileText, LockKeyhole, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button/Button';
import {
  recordingService,
  type RecordingDetail,
  type RecordingGoogleDocComposeContext,
} from '../../../services/Recording/recordingService';
import { initCalendarOAuth } from '../../../services/clients/calendarApi';

interface GoogleDocPreviewModalProps {
  recording: RecordingDetail;
  onClose: () => void;
  onExport: () => Promise<void>;
  isExporting: boolean;
}

export function GoogleDocPreviewModal({
  recording,
  onClose,
  onExport,
  isExporting,
}: GoogleDocPreviewModalProps): ReactElement {
  const [context, setContext] = useState<RecordingGoogleDocComposeContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void recordingService
      .getGoogleDocComposeContext(recording.externalId)
      .then(next => !cancelled && setContext(next))
      .catch(error => {
        if (cancelled) return;
        setContextError(
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
            (error instanceof Error ? error.message : 'Unable to prepare Google Docs export'),
        );
      });
    return (): void => {
      cancelled = true;
    };
  }, [recording.externalId]);

  const connectGoogleCalendar = async (): Promise<void> => {
    setIsConnecting(true);
    try {
      const returnPath = `${window.location.pathname}${window.location.search}`;
      const { authUrl } = await initCalendarOAuth('web', returnPath, 'docs_export');
      window.location.assign(authUrl);
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          (error instanceof Error ? error.message : 'Unable to start Google Calendar connection'),
      );
      setIsConnecting(false);
    }
  };

  const createGoogleDoc = async (): Promise<void> => {
    try {
      await onExport();
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error instanceof Error ? error.message : 'Google Docs access is required.');
      setContext({
        canExport: false,
        unavailableReason: message,
        summary: context?.summary ?? null,
      });
    }
  };

  const title = recording.title?.trim() || 'Untitled Recording';
  const summary = context?.summary?.replace(/\[clf-\d+\]/gi, '').trim();

  return (
    <div
      className='flex max-h-[88vh] w-full flex-col bg-background'
      data-testid='google-doc-preview-modal'
    >
      <header className='flex items-start justify-between gap-4 border-b border-border px-6 py-5 sm:px-8'>
        <div className='flex items-start gap-3'>
          <div className='mt-0.5 flex size-10 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground'>
            <FileText className='size-5' aria-hidden='true' />
          </div>
          <div>
            <h2 className='text-lg font-semibold leading-6 text-foreground'>Preview Google Doc</h2>
            <p className='mt-0.5 text-sm text-muted-foreground'>
              Review the recording summary before creating the document.
            </p>
          </div>
        </div>
        <button
          type='button'
          onClick={onClose}
          disabled={isExporting || isConnecting}
          className='-mr-1 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50'
          aria-label='Close Google Docs preview'
          data-track-category='RecordingDetailV2'
          data-track-name='close_google_doc_preview'
        >
          <X className='size-5' aria-hidden='true' />
        </button>
      </header>

      <div className='min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8'>
        <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          Document title
        </p>
        <h3 className='mt-1 text-base font-semibold text-foreground'>{title}</h3>
        <div className='mt-5 rounded-lg border border-border bg-muted/20 p-4'>
          <p className='mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            Summary
          </p>
          <div className='max-h-[42vh] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-foreground'>
            {context ? summary || 'No summary is available to export.' : 'Preparing preview…'}
          </div>
        </div>

        {contextError ? <p className='mt-4 text-sm text-destructive'>{contextError}</p> : null}
        {context && !context.canExport ? (
          <div className='mt-4 flex gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100'>
            <LockKeyhole className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
            <div className='flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3'>
              <p>{context.unavailableReason}</p>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void connectGoogleCalendar()}
                disabled={isConnecting}
                loading={isConnecting}
                data-track-category='RecordingDetailV2'
                data-track-name='recording_google_doc_connect_calendar'
              >
                Connect Google Calendar
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <footer className='flex items-center justify-end gap-2 border-t border-border px-6 py-4 sm:px-8'>
        <Button variant='outline' onClick={onClose} disabled={isExporting || isConnecting}>
          Cancel
        </Button>
        <Button
          onClick={() => void createGoogleDoc()}
          disabled={!context?.canExport || !!contextError || isConnecting}
          loading={isExporting}
          data-track-category='RecordingDetailV2'
          data-track-name='create_recording_google_doc'
        >
          Create Google Doc
        </Button>
      </footer>
    </div>
  );
}
