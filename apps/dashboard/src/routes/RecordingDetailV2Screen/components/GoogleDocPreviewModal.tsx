import { type MouseEvent, type ReactElement, useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ExternalLink,
  File as FileIcon,
  Link as LinkIcon,
  LockKeyhole,
  Plus,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button/Button';
import Input from '../../../components/ui/Input/Input';
import {
  recordingService,
  type RecordingDetail,
  type RecordingGoogleDocComposeContext,
  type RecordingGoogleDocLink,
} from '../../../services/Recording/recordingService';
import { formatDate, formatThreadTimestamp } from '../../../utils/dateUtils';
import { openLink } from '../../../utils/openLink';

/** Newest first, deduped by document id. */
function mergeGoogleDocLinks(
  ...lists: Array<RecordingGoogleDocLink[] | undefined>
): RecordingGoogleDocLink[] {
  const byId = new Map<string, RecordingGoogleDocLink>();
  for (const link of lists.flatMap(list => list ?? [])) {
    if (!byId.has(link.documentId)) byId.set(link.documentId, link);
  }
  return [...byId.values()].sort(
    (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
  );
}

/** Legacy/hand-edited metadata can carry an unparseable timestamp — show nothing rather than throw. */
function formatDocTimestamp(createdAt: string, style: 'date' | 'relative'): string | null {
  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) return null;
  return style === 'date' ? formatDate(timestamp) : formatThreadTimestamp(timestamp);
}

const LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.4px] text-muted-foreground';

const CONNECT_PROMPT = 'Connect Google Docs to create a document from this recording.';

interface GoogleDocPreviewModalProps {
  recording: RecordingDetail;
  onClose: () => void;
  /** Creates the doc; `title` names it. Rejects so this modal can surface the reason. */
  onExport: (title?: string) => Promise<void>;
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
  const [title, setTitle] = useState(() => recording.title?.trim() || 'Untitled Recording');
  const [earlierOpen, setEarlierOpen] = useState(false);

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

  const connectGoogleDoc = async (): Promise<void> => {
    setIsConnecting(true);
    try {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const returnPath =
        currentPath.startsWith('/') && !currentPath.startsWith('//') ? currentPath : '/recordings';
      const isElectron = typeof window.electronAPI?.openExternal === 'function';
      const authUrl = await recordingService.connectGoogleDoc(
        returnPath,
        isElectron ? 'electron' : 'web',
      );
      if (isElectron) {
        window.electronAPI?.openExternal(authUrl);
      } else {
        window.location.assign(authUrl);
      }
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          (error instanceof Error ? error.message : 'Unable to start Google Docs connection'),
      );
      setIsConnecting(false);
    }
  };

  const createGoogleDoc = async (): Promise<void> => {
    try {
      await onExport(title.trim() || undefined);
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error instanceof Error ? error.message : 'Google Docs access is required.');
      setContext({
        canExport: false,
        unavailableReason: message,
        summary: context?.summary ?? null,
        documents: context?.documents ?? [],
      });
    }
  };

  const openDoc = (event: MouseEvent<HTMLAnchorElement>, url: string): void => {
    event.preventDefault();
    openLink(url, event);
  };

  const copyDocLink = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const summary = context?.summary?.replace(/\[clf-\d+\]/gi, '').trim();
  // The recording row carries a doc the moment it is created, so it can be ahead
  // of the fetched context when this modal is reopened right after an export.
  const documents = mergeGoogleDocLinks(recording.googleDocs, context?.documents);
  const [latestDoc, ...earlierDocs] = documents;
  const isTitleEmpty = title.trim().length === 0;
  // Either the account was never connected, or the export just came back saying the
  // Docs scope is missing. Both leave nothing to create, so the footer becomes the
  // connect step instead of showing a create button that cannot succeed.
  const needsConnection = !!context && !context.canExport;

  return (
    <div
      className='flex max-h-[88vh] w-full flex-col bg-background'
      data-testid='google-doc-preview-modal'
    >
      <header className='flex flex-shrink-0 items-start gap-3 border-b border-border px-5 py-4'>
        <span className='flex size-[34px] shrink-0 items-center justify-center rounded-[9px] border border-border bg-background text-[#1a73e8] dark:text-[#8ab4f8]'>
          <FileIcon className='size-[18px]' aria-hidden='true' />
        </span>
        <div className='min-w-0 flex-1 pt-px'>
          <h2 className='text-[15.5px] font-semibold leading-6 tracking-[-0.01em] text-foreground'>
            Export to Google Doc
          </h2>
          <p className='mt-0.5 text-[12.5px] text-muted-foreground'>
            Review the recording summary before creating the document.
          </p>
        </div>
        <button
          type='button'
          onClick={onClose}
          disabled={isExporting || isConnecting}
          className='inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50'
          aria-label='Close Google Docs preview'
          data-track-category='RecordingDetailV2'
          data-track-name='close_google_doc_preview'
        >
          <X className='size-[15px]' aria-hidden='true' />
        </button>
      </header>

      <div className='min-h-0 flex-1 overflow-y-auto px-5 py-[18px]'>
        {latestDoc ? (
          <div
            className='mb-5 flex items-center gap-3 rounded-[13px] border border-emerald-300/70 bg-emerald-50 p-3.5 dark:border-emerald-500/40 dark:bg-emerald-950/25'
            data-testid='google-doc-latest-export'
          >
            <span className='inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-emerald-300/70 bg-background text-status-success dark:border-emerald-500/40'>
              <Check className='size-4' aria-hidden='true' />
            </span>
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-[7px]'>
                <span className='truncate text-[13.5px] font-semibold text-foreground'>
                  {latestDoc.title}
                </span>
                <span className='shrink-0 rounded-full border border-emerald-300/70 px-[7px] py-0.5 text-[9.5px] font-medium uppercase tracking-[0.3px] text-status-success dark:border-emerald-500/40'>
                  Latest
                </span>
              </div>
              <p className='mt-[3px] text-[11.5px] text-muted-foreground'>
                {formatDocTimestamp(latestDoc.createdAt, 'relative')
                  ? `Already exported ${formatDocTimestamp(latestDoc.createdAt, 'relative')} · Google Docs`
                  : 'Already exported to Google Docs'}
              </p>
            </div>
            <button
              type='button'
              onClick={() => void copyDocLink(latestDoc.url)}
              title='Copy link'
              aria-label='Copy document link'
              className='inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground'
              data-track-category='RecordingDetailV2'
              data-track-name='copy_recording_google_doc_link'
            >
              <LinkIcon className='size-[15px]' aria-hidden='true' />
            </button>
            <a
              href={latestDoc.url}
              target='_blank'
              rel='noopener noreferrer'
              onClick={event => openDoc(event, latestDoc.url)}
              className='inline-flex shrink-0 items-center gap-[7px] rounded-[9px] bg-foreground px-3 py-2 text-[12.5px] font-semibold text-background hover:opacity-90'
              data-track-category='RecordingDetailV2'
              data-track-name='open_recording_google_doc'
            >
              Open doc
              <SquareArrowOutUpRight className='size-3.5' aria-hidden='true' />
            </a>
          </div>
        ) : null}

        {earlierDocs.length > 0 ? (
          <div className='mb-5'>
            <button
              type='button'
              onClick={() => setEarlierOpen(open => !open)}
              className={`flex items-center gap-1.5 pb-2 ${LABEL_CLASS} hover:text-foreground`}
              aria-expanded={earlierOpen}
              data-track-category='RecordingDetailV2'
              data-track-name='toggle_earlier_google_doc_exports'
            >
              <ChevronDown
                className={`size-3 shrink-0 transition-transform ${earlierOpen ? '' : '-rotate-90'}`}
                aria-hidden='true'
              />
              <span>Earlier exports · {earlierDocs.length}</span>
            </button>
            {earlierOpen ? (
              <ul className='divide-y divide-border/70 overflow-hidden rounded-xl border border-border'>
                {earlierDocs.map(doc => (
                  <li key={doc.documentId} className='flex items-center gap-[11px] px-3 py-2.5'>
                    <span className='inline-flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border border-border bg-muted/40'>
                      <FileIcon className='size-3.5 text-muted-foreground' aria-hidden='true' />
                    </span>
                    <span className='min-w-0 flex-1 truncate text-[13px] text-foreground'>
                      {doc.title}
                    </span>
                    {formatDocTimestamp(doc.createdAt, 'date') ? (
                      <span className='shrink-0 font-mono text-[11px] text-muted-foreground'>
                        {formatDocTimestamp(doc.createdAt, 'date')}
                      </span>
                    ) : null}
                    <a
                      href={doc.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      onClick={event => openDoc(event, doc.url)}
                      className='inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted'
                      data-track-category='RecordingDetailV2'
                      data-track-name='open_recording_google_doc'
                    >
                      Open
                      <ExternalLink className='size-3' aria-hidden='true' />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <label className={`mb-[7px] block ${LABEL_CLASS}`} htmlFor='google-doc-title'>
          Document title
        </label>
        <Input
          id='google-doc-title'
          variant='flat'
          value={title}
          onChange={event => setTitle(event.target.value)}
          maxLength={240}
          aria-invalid={isTitleEmpty}
          className='h-auto py-2.5 text-sm font-semibold tracking-[-0.01em]'
          data-testid='google-doc-title-input'
        />

        <p className={`mb-[7px] mt-[18px] ${LABEL_CLASS}`}>Summary preview</p>
        <div className='max-h-[320px] overflow-y-auto whitespace-pre-wrap text-[13px] leading-[1.6] text-foreground'>
          {context ? summary || 'No summary is available to export.' : 'Preparing preview…'}
        </div>

        {contextError ? <p className='mt-4 text-sm text-destructive'>{contextError}</p> : null}
      </div>

      <footer className='flex flex-shrink-0 items-center gap-3 border-t border-border bg-muted/30 px-[18px] py-3'>
        {needsConnection ? (
          <>
            <p className='flex min-w-0 flex-1 items-start gap-2 text-[11.5px] text-amber-700 dark:text-amber-200'>
              <LockKeyhole className='mt-px size-3.5 shrink-0' aria-hidden='true' />
              <span>{context?.unavailableReason ?? CONNECT_PROMPT}</span>
            </p>
            <Button
              className='bg-foreground text-background hover:bg-foreground/90'
              onClick={() => void connectGoogleDoc()}
              disabled={isConnecting}
              loading={isConnecting}
              data-track-category='RecordingDetailV2'
              data-track-name='recording_google_doc_connect_calendar'
            >
              Connect Google Docs
            </Button>
          </>
        ) : (
          <>
            <p className='min-w-0 flex-1 text-[11.5px] text-muted-foreground'>
              {latestDoc
                ? 'A new doc is created as a separate copy — the existing one stays as it is.'
                : null}
            </p>
            <Button
              variant='outline'
              onClick={onClose}
              data-track-category='RecordingDetailV2'
              data-track-name='cancel_google_doc_export'
              disabled={isExporting}
            >
              Cancel
            </Button>
            <Button
              variant={latestDoc ? 'outline' : 'default'}
              // The design's create action is the inverted (foreground) button, not the
              // red primary — `default` only carries the size/shape here.
              className={
                latestDoc ? undefined : 'bg-foreground text-background hover:bg-foreground/90'
              }
              onClick={() => void createGoogleDoc()}
              disabled={!context?.canExport || !!contextError || isTitleEmpty}
              loading={isExporting}
              data-track-category='RecordingDetailV2'
              data-track-name='create_recording_google_doc'
            >
              {latestDoc ? (
                <>
                  <Plus className='size-[15px]' aria-hidden='true' />
                  Create another doc
                </>
              ) : (
                'Create Google Doc'
              )}
            </Button>
          </>
        )}
      </footer>
    </div>
  );
}
