import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '../../ui/Button';
import { EditorToolbar } from '../../ui/EditorToolbar/EditorToolbar';
import { renderCallInvitationHtml } from '@xyne/shared';
import { isValidDate } from './dateTime';

export interface InvitationPreviewData {
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  organizerName: string;
  organizerEmail: string;
  orgName?: string;
  joinUrlPlaceholder: string;
}

interface InvitationPreviewStepProps {
  recipients: string[];
  messageHtml: string;
  onMessageChange: (html: string) => void;

  editableTitle: string;
  onEditableTitleChange: (v: string) => void;
  editableOrganizerName: string;
  onEditableOrganizerNameChange: (v: string) => void;
  editableOrganizerEmail: string;
  onEditableOrganizerEmailChange: (v: string) => void;
  editableOrgName: string;
  onEditableOrgNameChange: (v: string) => void;

  data: InvitationPreviewData;
  onBack: () => void;
  onSend: () => void;
  isSubmitting?: boolean;
}

export const InvitationPreviewStep: React.FC<InvitationPreviewStepProps> = ({
  recipients,
  messageHtml,
  onMessageChange,
  editableTitle,
  onEditableTitleChange,
  editableOrganizerName,
  onEditableOrganizerNameChange,
  editableOrganizerEmail,
  onEditableOrganizerEmailChange,
  editableOrgName,
  onEditableOrgNameChange,
  data,
  onBack,
  onSend,
  isSubmitting,
}) => {
  // Lets the prop-sync effect ignore the user's own typing echoing back.
  const lastEmittedHtmlRef = useRef<string>(messageHtml ?? '');
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        bold: { HTMLAttributes: { class: 'font-semibold' } },
        italic: { HTMLAttributes: { class: 'italic' } },
        bulletList: { HTMLAttributes: { class: 'list-disc pl-6' } },
        orderedList: { HTMLAttributes: { class: 'list-decimal pl-6' } },
        blockquote: { HTMLAttributes: { class: 'border-l-2 pl-3 text-muted-foreground' } },
        paragraph: { HTMLAttributes: { class: 'm-0 leading-6' } },
      }),
      Link.extend({ inclusive: false }).configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-blue-600 underline cursor-pointer' },
      }),
      Placeholder.configure({
        placeholder: 'Write a note for your invitees — add links, lists, bold accents…',
      }),
    ],
    editorProps: {
      attributes: {
        class:
          'tiptap prose prose-sm max-w-none focus:outline-none px-3 py-3 text-sm whitespace-pre-wrap break-words',
      },
    },
    content: messageHtml || '',
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      lastEmittedHtmlRef.current = html;
      onMessageChange(html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (messageHtml === lastEmittedHtmlRef.current) return;
    if (messageHtml === editor.getHTML()) return;
    editor.commands.setContent(messageHtml || '', { emitUpdate: false });
    lastEmittedHtmlRef.current = messageHtml ?? '';
  }, [messageHtml, editor]);

  // Stop link clicks inside the preview iframe from navigating the iframe
  // (or anywhere else). The preview uses placeholder URLs and is not meant
  // to be interactive — clicks should be inert.
  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (!iframe) return;
    const handleLoad = (): void => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      doc.addEventListener(
        'click',
        e => {
          const anchor = (e.target as HTMLElement | null)?.closest?.('a');
          if (anchor) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
        true,
      );
    };
    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, []);

  // Debounce so the preview iframe doesn't reload on every keystroke.
  const debouncedMessage = useDebouncedValue(messageHtml, 200);
  const safeData = useMemo(() => {
    const startsAt = isValidDate(data.startsAt) ? data.startsAt : new Date();
    const endsAt =
      isValidDate(data.endsAt) && data.endsAt > startsAt
        ? data.endsAt
        : new Date(startsAt.getTime() + 60 * 60 * 1000);

    return {
      ...data,
      startsAt,
      endsAt,
    };
  }, [data]);
  const debouncedData = useDebouncedValue(safeData, 200);

  const previewHtml = useMemo(
    () =>
      renderCallInvitationHtml({
        title: debouncedData.title,
        startsAt: debouncedData.startsAt,
        endsAt: debouncedData.endsAt,
        timezone: debouncedData.timezone,
        organizerName: debouncedData.organizerName,
        organizerEmail: debouncedData.organizerEmail,
        ...(debouncedData.orgName ? { orgName: debouncedData.orgName } : {}),
        joinUrl: debouncedData.joinUrlPlaceholder,
        userBodyHtml: debouncedMessage || '<p></p>',
      }),
    [debouncedMessage, debouncedData],
  );

  const whenDisplay = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: safeData.timezone || 'UTC',
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${fmt.format(safeData.startsAt)} – ${fmt.format(safeData.endsAt)} (${safeData.timezone || 'UTC'})`;
  }, [safeData]);

  return (
    <div className='flex flex-col flex-1 min-h-0'>
      {/* ── Main: editor + live preview ─────────────────────────────────── */}
      <div className='flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(380px,440px)_1fr] gap-4 p-4 overflow-hidden'>
        {/* Edit column */}
        <div className='flex flex-col gap-3 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden pr-2'>
          <Section label='To'>
            <div className='flex flex-wrap gap-1'>
              {recipients.map(r => (
                <span
                  key={r}
                  className='inline-flex items-center bg-muted rounded px-2 py-0.5 text-[11px]'
                >
                  {r}
                </span>
              ))}
            </div>
          </Section>

          <Section label='When (from the scheduler)'>
            <div className='flex items-center gap-2 text-[13px] text-foreground/80 bg-muted/30 border border-dashed border-border rounded px-2.5 py-1.5'>
              <CalendarIcon size={13} className='text-muted-foreground' />
              <span className='font-medium'>{whenDisplay}</span>
            </div>
          </Section>

          <Section label='Header details'>
            <div className='flex flex-col gap-2'>
              <LabeledInput
                label='Title'
                placeholder='Falls back to call title'
                value={editableTitle}
                onChange={onEditableTitleChange}
              />
              <div className='grid grid-cols-2 gap-2'>
                <LabeledInput
                  label='Your name'
                  placeholder={data.organizerName || 'Organizer'}
                  value={editableOrganizerName}
                  onChange={onEditableOrganizerNameChange}
                />
                <LabeledInput
                  label='Your email'
                  placeholder={data.organizerEmail || 'you@company.com'}
                  value={editableOrganizerEmail}
                  onChange={onEditableOrganizerEmailChange}
                  inputMode='email'
                />
              </div>
              <LabeledInput
                label='Team / organization (optional)'
                placeholder='Appears above the title'
                value={editableOrgName}
                onChange={onEditableOrgNameChange}
              />
            </div>
          </Section>

          <Section label='Message'>
            <div className='border border-border rounded-md overflow-hidden flex flex-col'>
              <EditorToolbar editor={editor} />
              {/* Inner scroll — keeps the editor box bounded while letting the user type as much as they want. */}
              <div
                role='button'
                tabIndex={0}
                onClick={() => editor?.commands.focus()}
                onKeyDown={e => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    editor?.commands.focus();
                  }
                }}
                data-track-category='calls'
                data-track-name='focus-invitation-message'
                className='cursor-text overflow-y-auto overflow-x-hidden overscroll-contain min-w-0'
                style={{ minHeight: 220, maxHeight: 340 }}
              >
                <EditorContent editor={editor} />
              </div>
            </div>
            <p className='mt-1 text-[11px] text-muted-foreground'>
              Select text to format · add links to external resources · scroll inside the box for
              long messages.
            </p>
          </Section>
        </div>

        {/* Preview column */}
        <div className='min-w-0 min-h-0 flex flex-col'>
          <div className='flex items-center justify-between mb-1'>
            <p className='text-[11px] font-semibold tracking-[0.16em] uppercase text-muted-foreground'>
              Live preview
            </p>
          </div>
          <div className='border rounded-md overflow-hidden bg-neutral-100 flex-1 min-h-0'>
            <iframe
              ref={previewIframeRef}
              title='Invitation preview'
              srcDoc={previewHtml}
              sandbox='allow-same-origin'
              className='w-full h-full bg-white'
            />
          </div>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className='flex justify-between items-center border-t p-3 shrink-0'>
        <Button
          variant='ghost'
          onClick={onBack}
          data-track-category='calls'
          data-track-name='BACK_FROM_INVITATION_PREVIEW'
          disabled={isSubmitting}
        >
          Back
        </Button>
        <div className='flex items-center gap-3'>
          <p className='text-[11px] text-muted-foreground'>
            Sending to <strong className='text-foreground'>{recipients.length}</strong> external
            {recipients.length === 1 ? '' : 's'} as a reply.
          </p>
          <Button
            onClick={onSend}
            data-track-category='calls'
            data-track-name='SEND_CALL_INVITATION'
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Sending…' : 'Send & schedule'}
          </Button>
        </div>
      </div>
    </div>
  );
};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className='text-[11px] font-semibold tracking-[0.16em] uppercase text-muted-foreground mb-1'>
      {label}
    </p>
    {children}
  </div>
);

const LabeledInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}> = ({ label, value, onChange, placeholder, inputMode }) => (
  <label className='flex flex-col gap-0.5'>
    <span className='text-[10px] tracking-[0.14em] uppercase text-muted-foreground/80'>
      {label}
    </span>
    <input
      type='text'
      inputMode={inputMode}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      data-track-category='calls'
      data-track-name='edit-invitation-field'
      className='h-8 px-2.5 text-[13px] border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-foreground/40'
    />
  </label>
);
