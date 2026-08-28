import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  FileText,
  Loader2,
  LockKeyhole,
  Mail,
  Music,
  Paperclip,
  Send,
  Sparkles,
  StickyNote,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { EmailEditor } from '../../../components/xyne-desk/EmailEditor/EmailEditor';
import { EmailTagWithAvatar } from '../../../components/xyne-desk/EmailTagWithAvatar/EmailTagWithAvatar';
import {
  RecipientSuggestionsDropdown,
  type RecipientSuggestion,
} from '../../../components/xyne-desk/RecipientSuggestionsDropdown/RecipientSuggestionsDropdown';
import {
  buildContactPool,
  buildSuggestions,
  makeRecipientKeyDownHandler,
  type RecipientField,
} from '../../../components/xyne-desk/EmailComposer/recipients';
import { stripHtml } from '../../../components/xyne-desk/EmailComposer/helpers';
import { useDeskContacts } from '../../../hooks/useDeskContacts';
import { useUsers } from '../../../hooks/useUsers';
import { markdownToHtml } from '../../../utils/clipboardUtils';
import {
  recordingEmailService,
  type RecordingEmailAttachmentKind,
  type RecordingEmailComposeContext,
} from '../../../services/Recording/recordingEmailService';
import type { RecordingDetail } from '../../../services/Recording/recordingService';

/** Only the fields the draft is built from — a call has no full RecordingDetail. */
export type EmailDraftSource = Pick<
  RecordingDetail,
  'externalId' | 'title' | 'aiSummary' | 'aiSummaryFormat'
>;

export interface PostRecordingToEmailModalProps {
  recording: EmailDraftSource;
  onClose: () => void;
  /**
   * The word the copy uses for what is being sent: 'recording' or 'call'. Not
   * `subject` — that name already belongs to the email's own subject line.
   */
  entityLabel?: string;
  /** False routes the request to the regular-call endpoints. */
  isRecording?: boolean;
  /** Analytics namespace of the host screen. */
  trackCategory?: string;
}

interface RecipientLineProps {
  field: Extract<RecipientField, 'to' | 'cc'>;
  label: string;
  emails: string[];
  onEmailsChange: (emails: string[]) => void;
  contactPool: RecipientSuggestion[];
  users: ReturnType<typeof useUsers>;
  actions?: ReactNode;
  trackCategory: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const attachmentIcon = (kind: RecordingEmailAttachmentKind): ReactElement => {
  switch (kind) {
    case 'recording':
      return <Music className='size-4 text-emerald-600' aria-hidden='true' />;
    case 'notes':
      return <StickyNote className='size-4 text-sky-600' aria-hidden='true' />;
    case 'detailed-summary':
      return <Sparkles className='size-4 text-amber-500' aria-hidden='true' />;
    default:
      return <FileText className='size-4 text-blue-600' aria-hidden='true' />;
  }
};

const summaryHtmlForEmail = async (recording: EmailDraftSource): Promise<string> => {
  const rawSummary = recording.aiSummary?.replace(/\[clf-\d+\]/gi, '').trim();
  if (!rawSummary) return '';
  if (recording.aiSummaryFormat === 'html') return DOMPurify.sanitize(rawSummary);
  return markdownToHtml(rawSummary);
};

const buildInitialEmailBody = async (
  recording: EmailDraftSource,
  entityLabel: string,
): Promise<string> => {
  const title = escapeHtml(recording.title?.trim() || `this ${entityLabel}`);
  const summary = await summaryHtmlForEmail(recording);
  const summarySection = summary
    ? summary
    : '<p><strong>Summary</strong></p><p>Add the key discussion points, decisions, and owners here.</p>';

  return [
    '<p>Hi all,</p>',
    `<p>Here is a recap of <strong>${title}</strong>. Please flag anything that needs correcting.</p>`,
    summarySection,
  ].join('');
};

const RecipientLine = ({
  field,
  label,
  emails,
  onEmailsChange,
  contactPool,
  users,
  actions,
  trackCategory,
}: RecipientLineProps): ReactElement => {
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const suggestions = useMemo(
    () => buildSuggestions(contactPool, inputValue, emails),
    [contactPool, inputValue, emails],
  );

  const selectSuggestion = (email: string): void => {
    if (!emails.some(existing => existing.toLowerCase() === email.toLowerCase())) {
      onEmailsChange([...emails, email]);
    }
    setInputValue('');
    setHighlightedIndex(0);
    setSuggestionsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = makeRecipientKeyDownHandler({
    field,
    inputValue,
    emails,
    setEmails: onEmailsChange,
    setInputValue,
    suggestions,
    suggestionIndex: highlightedIndex,
    setSuggestionIndex: updater => setHighlightedIndex(updater),
    activeSuggestField: suggestionsOpen ? field : null,
    closeSuggestions: () => setSuggestionsOpen(false),
    onSuggestionSelect: (_field, email) => selectSuggestion(email),
  });

  return (
    <div className='grid grid-cols-[48px_minmax(0,1fr)_auto] gap-x-3 border-b border-border/70 px-6 py-3 last:border-b-0 sm:px-8'>
      <label className='pt-1.5 text-sm font-semibold text-foreground'>{label}</label>
      <div
        ref={rowRef}
        role='button'
        tabIndex={0}
        className='relative flex min-h-8 flex-wrap items-center gap-1.5 rounded-md py-0.5 focus-within:outline-none focus-within:ring-2 focus-within:ring-ring/70'
        onClick={() => inputRef.current?.focus()}
        data-track-category={trackCategory}
        data-track-name={`recording_email_${field}_recipients_focus`}
        onKeyDown={event => {
          if (
            event.target === event.currentTarget &&
            (event.key === 'Enter' || event.key === ' ')
          ) {
            event.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {emails.map(email => (
          <EmailTagWithAvatar
            key={email}
            email={email}
            users={users}
            onRemove={() => onEmailsChange(emails.filter(existing => existing !== email))}
          />
        ))}
        <input
          ref={inputRef}
          type='text'
          value={inputValue}
          placeholder={emails.length === 0 ? 'Add people...' : ''}
          onChange={event => {
            setInputValue(event.target.value);
            setHighlightedIndex(0);
            setSuggestionsOpen(true);
          }}
          onFocus={() => setSuggestionsOpen(true)}
          onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 100)}
          onKeyDown={handleKeyDown}
          className='min-w-[126px] flex-1 bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground'
          aria-label={`${label} recipients`}
          data-track-category={trackCategory}
          data-track-name={`recording_email_${field}_input`}
        />
        <RecipientSuggestionsDropdown
          visible={suggestionsOpen}
          suggestions={suggestions}
          highlightedIndex={highlightedIndex}
          onSelect={selectSuggestion}
          onHighlight={setHighlightedIndex}
          anchorRef={rowRef}
        />
      </div>
      <div className='pt-1'>{actions}</div>
    </div>
  );
};

export const PostRecordingToEmailModal = ({
  recording,
  onClose,
  entityLabel = 'recording',
  isRecording = true,
  trackCategory = 'RecordingDetailV2',
}: PostRecordingToEmailModalProps): ReactElement => {
  const users = useUsers();
  const [context, setContext] = useState<RecordingEmailComposeContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(
    `Recap: ${recording.title?.trim() || (isRecording ? 'Untitled Recording' : 'Untitled Call')}`,
  );
  const [body, setBody] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<RecordingEmailAttachmentKind[]>(
    [],
  );
  const [isSending, setIsSending] = useState(false);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const initializedAttachmentsRef = useRef(false);
  const initializedBodyRef = useRef(false);

  const deskContacts = useDeskContacts(context?.channelId ?? undefined);
  const contactPool = useMemo(
    () =>
      buildContactPool(
        users.filter(user => user.email.toLowerCase() !== context?.from.email.toLowerCase()),
        deskContacts,
        [],
        context?.from.email ?? '',
      ),
    [users, deskContacts, context?.from.email],
  );

  useEffect(() => {
    let cancelled = false;
    setContext(null);
    setContextError(null);
    void recordingEmailService
      .getComposeContext(recording.externalId, isRecording)
      .then(next => {
        if (cancelled) return;
        setContext(next);
        if (!initializedAttachmentsRef.current) {
          initializedAttachmentsRef.current = true;
          setSelectedAttachments(next.attachments.map(attachment => attachment.kind));
        }
      })
      .catch(error => {
        if (cancelled) return;
        const message =
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          (error instanceof Error ? error.message : 'Unable to prepare this email');
        setContextError(message);
      });
    return (): void => {
      cancelled = true;
    };
  }, [recording.externalId, isRecording]);

  useEffect(() => {
    if (initializedBodyRef.current) return;
    let cancelled = false;
    void buildInitialEmailBody(recording, entityLabel).then(nextBody => {
      if (cancelled) return;
      initializedBodyRef.current = true;
      setBody(nextBody);
    });
    return (): void => {
      cancelled = true;
    };
  }, [recording, entityLabel]);

  const selectedAttachmentDetails = useMemo(
    () =>
      (context?.attachments ?? []).filter(attachment =>
        selectedAttachments.includes(attachment.kind),
      ),
    [context?.attachments, selectedAttachments],
  );
  const addableAttachments = useMemo(
    () =>
      (context?.attachments ?? []).filter(
        attachment => !selectedAttachments.includes(attachment.kind),
      ),
    [context?.attachments, selectedAttachments],
  );
  const hasBody = stripHtml(body).trim().length > 0;
  const canSend =
    !!context?.canSend &&
    !isSending &&
    toEmails.length > 0 &&
    subject.trim().length > 0 &&
    (hasBody || selectedAttachments.length > 0);

  const addAttachment = (kind: RecordingEmailAttachmentKind): void => {
    setSelectedAttachments(previous => (previous.includes(kind) ? previous : [...previous, kind]));
  };

  const removeAttachment = (kind: RecordingEmailAttachmentKind): void => {
    setSelectedAttachments(previous => previous.filter(current => current !== kind));
  };

  const handleSend = async (): Promise<void> => {
    if (!canSend) return;
    setIsSending(true);
    try {
      await recordingEmailService.send(
        recording.externalId,
        {
          to: toEmails,
          cc: ccEmails,
          subject: subject.trim(),
          body,
          attachments: selectedAttachments,
        },
        isRecording,
      );
      toast.success('Email sent');
      onClose();
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string; message?: string } } })?.response?.data
          ?.error ||
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (error instanceof Error ? error.message : 'Failed to send email');
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleConnectGoogle = async (): Promise<void> => {
    setIsConnectingGoogle(true);
    try {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const returnPath =
        currentPath.startsWith('/') && !currentPath.startsWith('//') ? currentPath : '/recordings';
      // In Electron the consent screen has to open in the system browser, and the backend
      // needs to know so it can send the callback back through /launch (deep link) instead
      // of leaving the user stranded on the web app.
      const isElectron = typeof window.electronAPI?.openExternal === 'function';
      const authUrl = await recordingEmailService.connectGoogle(
        returnPath,
        isElectron ? 'electron' : 'web',
      );
      if (isElectron) {
        window.electronAPI?.openExternal(authUrl);
      } else {
        window.location.assign(authUrl);
      }
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error instanceof Error ? error.message : 'Unable to start Google email connection');
      toast.error(message);
      setIsConnectingGoogle(false);
    }
  };

  const fromInitial = (context?.from.name || context?.from.email || '?').charAt(0).toUpperCase();

  return (
    <div
      className='flex max-h-[88vh] min-h-0 w-full flex-col bg-background'
      data-testid='post-recording-to-email-modal'
    >
      <header className='flex items-start justify-between gap-4 border-b border-border px-6 py-5 sm:px-8'>
        <div className='flex min-w-0 items-start gap-3'>
          <div className='mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground'>
            <Mail className='size-5' aria-hidden='true' />
          </div>
          <div className='min-w-0'>
            <h2 className='text-lg font-semibold leading-6 text-foreground'>Review draft email</h2>
            <p className='mt-0.5 text-sm text-muted-foreground'>
              Recipients and text are pre-filled from this {entityLabel}. Review before sending.
            </p>
          </div>
        </div>
        <Tooltip content='Close'>
          <button
            type='button'
            onClick={onClose}
            disabled={isSending}
            className='-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
            aria-label='Close email draft'
            data-track-category={trackCategory}
            data-track-name='close_recording_email_draft'
          >
            <X className='size-5' aria-hidden='true' />
          </button>
        </Tooltip>
      </header>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='border-b border-border/70 px-6 py-3 sm:px-8'>
          <div className='grid grid-cols-[48px_minmax(0,1fr)] items-center gap-x-3'>
            <span className='text-sm font-semibold text-foreground'>From</span>
            {context ? (
              <div className='flex min-w-0 items-center gap-2.5 text-sm text-foreground'>
                <span className='flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background'>
                  {fromInitial}
                </span>
                <span className='truncate font-medium'>{context.from.name}</span>
                <span className='truncate text-muted-foreground'>&lt;{context.from.email}&gt;</span>
              </div>
            ) : contextError ? (
              <span className='text-sm text-destructive'>{contextError}</span>
            ) : (
              <span className='inline-flex items-center gap-2 text-sm text-muted-foreground'>
                <Loader2 className='size-4 animate-spin' aria-hidden='true' /> Loading account
              </span>
            )}
          </div>
        </div>

        <RecipientLine
          field='to'
          label='To'
          emails={toEmails}
          onEmailsChange={setToEmails}
          contactPool={contactPool}
          users={users}
          trackCategory={trackCategory}
          actions={
            !showCc ? (
              <button
                type='button'
                onClick={() => setShowCc(true)}
                className='rounded px-1 py-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
                data-track-category={trackCategory}
                data-track-name='recording_email_open_cc'
              >
                Cc
              </button>
            ) : null
          }
        />
        {showCc ? (
          <RecipientLine
            field='cc'
            label='Cc'
            emails={ccEmails}
            onEmailsChange={setCcEmails}
            contactPool={contactPool}
            users={users}
            trackCategory={trackCategory}
            actions={
              <button
                type='button'
                onClick={() => {
                  setCcEmails([]);
                  setShowCc(false);
                }}
                className='inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                aria-label='Remove Cc field'
                data-track-category={trackCategory}
                data-track-name='recording_email_remove_cc'
              >
                <X className='size-3.5' aria-hidden='true' />
              </button>
            }
          />
        ) : null}

        <label className='grid grid-cols-[48px_minmax(0,1fr)] gap-x-3 border-b border-border/70 px-6 py-3 sm:px-8'>
          <span className='pt-1.5 text-sm font-semibold text-foreground'>Subject</span>
          <input
            type='text'
            value={subject}
            onChange={event => setSubject(event.target.value)}
            className='min-w-0 bg-transparent py-1 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground'
            placeholder='Add a subject'
            aria-label='Email subject'
            data-track-category={trackCategory}
            data-track-name='recording_email_subject_input'
          />
        </label>

        {context && !context.canSend ? (
          <div className='mx-6 mt-4 flex gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100 sm:mx-8'>
            <Mail className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
            <div className='flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3'>
              <p>{context.unavailableReason ?? 'No outbound email account is available.'}</p>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void handleConnectGoogle()}
                disabled={isConnectingGoogle || isSending}
                loading={isConnectingGoogle}
                data-track-category={trackCategory}
                data-track-name='recording_email_connect_google'
              >
                Connect Google email
              </Button>
            </div>
          </div>
        ) : null}

        <div className='px-6 py-5 sm:px-8'>
          <EmailEditor
            value={body}
            onChange={setBody}
            placeholder='Write the recording recap...'
            disabled={isSending}
            className='recording-email-editor min-h-[280px]'
          />
        </div>

        <section
          className='border-t border-border bg-muted/20 px-6 py-4 sm:px-8'
          aria-label='Attachments'
        >
          <div className='mb-3 flex items-center justify-between gap-3'>
            <div className='flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground'>
              <Paperclip className='size-4' aria-hidden='true' />
              Attachments
              <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
                {selectedAttachmentDetails.length}
              </span>
            </div>
            {addableAttachments.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    className='inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                    aria-label='Add attachment'
                    disabled={isSending}
                  >
                    <Paperclip className='size-4' aria-hidden='true' />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='min-w-[230px]'>
                  {addableAttachments.map(attachment => (
                    <DropdownMenuItem
                      key={attachment.kind}
                      onSelect={() => addAttachment(attachment.kind)}
                      className='flex items-center gap-2'
                    >
                      {attachmentIcon(attachment.kind)}
                      <span className='min-w-0 flex-1 truncate'>{attachment.label}</span>
                      <span className='text-xs text-muted-foreground'>{attachment.detail}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {selectedAttachmentDetails.length > 0 ? (
            <div className='flex flex-wrap gap-2'>
              {selectedAttachmentDetails.map(attachment => (
                <div
                  key={attachment.kind}
                  className='flex min-w-[190px] max-w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2'
                >
                  <span className='flex size-7 shrink-0 items-center justify-center rounded-md bg-muted'>
                    {attachmentIcon(attachment.kind)}
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate text-sm font-medium text-foreground'>
                      {attachment.filename}
                    </span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {attachment.detail}
                    </span>
                  </span>
                  <button
                    type='button'
                    onClick={() => removeAttachment(attachment.kind)}
                    className='inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                    aria-label={`Remove ${attachment.label}`}
                    disabled={isSending}
                    data-track-category={trackCategory}
                    data-track-name='recording_email_remove_attachment'
                  >
                    <X className='size-3.5' aria-hidden='true' />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>No recording files selected.</p>
          )}
        </section>
      </div>

      <footer className='flex flex-col-reverse gap-3 border-t border-border bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8'>
        <span className='inline-flex items-center gap-2 text-sm text-muted-foreground'>
          <LockKeyhole className='size-4' aria-hidden='true' />
          Nothing sends until you hit Send
        </span>
        <div className='flex items-center justify-end gap-2'>
          <Button variant='outline' onClick={onClose} disabled={isSending}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSend()}
            disabled={!canSend}
            className='min-w-[164px] gap-2'
            data-track-category={trackCategory}
            data-track-name='send_recording_email'
          >
            {isSending ? <Loader2 className='size-4 animate-spin' /> : <Send className='size-4' />}
            {isSending
              ? 'Sending...'
              : `Send to ${toEmails.length || 0} ${toEmails.length === 1 ? 'person' : 'people'}`}
          </Button>
        </div>
      </footer>
    </div>
  );
};

export default PostRecordingToEmailModal;
