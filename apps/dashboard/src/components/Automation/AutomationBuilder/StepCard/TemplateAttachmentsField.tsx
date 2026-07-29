import { useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  Code2,
  Download,
  FileCode2,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  Upload,
  Variable,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Dialog } from '../../../ui/Dialog/Dialog';
import { Popover } from '../../../ui/Popover/Popover';
import { cn } from '../../../../utils/classNames';
import {
  fetchAutomationTemplateContent,
  releaseAutomationTemplate,
  uploadAutomationTemplates,
  type AutomationTemplateAttachment,
} from '../../../../api/automationsApi';
import { VariablePicker } from '../VariablePicker/VariablePicker';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';

const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const ACCEPT = '.txt,.md,.html';
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.html']);

type EditorSession =
  | { kind: 'new'; filename: string }
  | { kind: 'existing'; attachment: AutomationTemplateAttachment };

interface TemplateAttachmentsFieldProps {
  stepId: string;
  value: AutomationTemplateAttachment[];
  onChange: (next: AutomationTemplateAttachment[]) => void;
  variableSources: VariablePickerSource[];
  readOnly?: boolean;
}

export function TemplateAttachmentsField({
  stepId,
  value,
  onChange,
  variableSources,
  readOnly = false,
}: TemplateAttachmentsFieldProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editorSession, setEditorSession] = useState<EditorSession | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [variableOpen, setVariableOpen] = useState(false);

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

  const openEditor = async (attachment: AutomationTemplateAttachment): Promise<void> => {
    setEditorSession({ kind: 'existing', attachment });
    setEditorContent('');
    setEditorLoading(true);
    try {
      setEditorContent(await fetchAutomationTemplateContent(attachment.attachmentId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the file');
      setEditorSession(null);
    } finally {
      setEditorLoading(false);
    }
  };

  const openNewFileEditor = (): void => {
    setEditorSession({ kind: 'new', filename: 'untitled.md' });
    setEditorContent('');
    setEditorLoading(false);
  };

  const saveEditor = async (): Promise<void> => {
    if (!editorSession) return;
    const filename =
      editorSession.kind === 'new'
        ? editorSession.filename.trim()
        : editorSession.attachment.originalFilename;
    if (editorSession.kind === 'new' && getBasename(filename).trim().length === 0) {
      toast.error('Enter a file name');
      return;
    }
    const mimetype = getMimetype(filename);
    if (!mimetype) {
      toast.error('File name must end in .txt, .md, or .html');
      return;
    }
    const blob = new Blob([editorContent], { type: mimetype });
    if (blob.size > MAX_FILE_BYTES) {
      toast.error('Edited file exceeds the 10MB limit');
      return;
    }
    const replacedId =
      editorSession.kind === 'existing' ? editorSession.attachment.attachmentId : null;
    const totalAfterEdit = value.reduce(
      (sum, file) => sum + (file.attachmentId === replacedId ? blob.size : file.size),
      editorSession.kind === 'new' ? blob.size : 0,
    );
    if (totalAfterEdit > MAX_TOTAL_BYTES) {
      toast.error('Total attachment size cannot exceed 25MB');
      return;
    }
    setEditorSaving(true);
    try {
      const [replacement] = await uploadAutomationTemplates(stepId, [
        new File([blob], filename, { type: mimetype }),
      ]);
      if (!replacement) throw new Error('The file was not saved');
      onChange(
        editorSession.kind === 'new'
          ? [...value, replacement]
          : value.map(file => (file.attachmentId === replacedId ? replacement : file)),
      );
      if (replacedId) void releaseTemplate(replacedId);
      setEditorSession(null);
      toast.success(
        editorSession.kind === 'new' ? 'File created and attached' : 'File changes applied',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the file');
    } finally {
      setEditorSaving(false);
    }
  };

  const download = async (attachment: AutomationTemplateAttachment): Promise<void> => {
    try {
      const content = await fetchAutomationTemplateContent(attachment.attachmentId);
      const url = URL.createObjectURL(new Blob([content], { type: attachment.mimetype }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.originalFilename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not download the file');
    }
  };

  const insertVariable = (reference: string): void => {
    const editor = editorRef.current;
    const start = editor?.selectionStart ?? editorContent.length;
    const end = editor?.selectionEnd ?? start;
    const next = `${editorContent.slice(0, start)}${reference}${editorContent.slice(end)}`;
    setEditorContent(next);
    requestAnimationFrame(() => {
      editor?.focus();
      editor?.setSelectionRange(start + reference.length, start + reference.length);
    });
  };

  return (
    <div className='flex flex-col gap-2'>
      {value.length > 0 ? (
        <div
          className='overflow-hidden rounded-md border border-border'
          data-testid='automation-attachments'
        >
          {value.map((attachment, index) => (
            <div
              key={attachment.attachmentId}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5',
                index > 0 && 'border-t border-border',
              )}
            >
              <div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300'>
                {attachment.mimetype === 'text/html' ? (
                  <FileCode2 className='size-4' />
                ) : (
                  <FileText className='size-4' />
                )}
              </div>
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium text-foreground'>
                  {attachment.originalFilename}
                </div>
                <div className='flex items-center gap-2 text-[11px] text-muted-foreground'>
                  <span>{formatBytes(attachment.size)}</span>
                  {attachment.templatePaths.length > 0 ? (
                    <span className='rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300'>
                      {attachment.templatePaths.length} variable
                      {attachment.templatePaths.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className='flex items-center gap-0.5'>
                <IconButton
                  label='Download file'
                  onClick={() => void download(attachment)}
                  forceInteractive={readOnly}
                >
                  <Download className='size-3.5' />
                </IconButton>
                {!readOnly ? (
                  <>
                    <IconButton
                      label='Edit file template'
                      onClick={() => void openEditor(attachment)}
                    >
                      <Pencil className='size-3.5' />
                    </IconButton>
                    <IconButton
                      label='Remove file'
                      onClick={() => {
                        onChange(
                          value.filter(file => file.attachmentId !== attachment.attachmentId),
                        );
                        void releaseTemplate(attachment.attachmentId);
                      }}
                    >
                      <Trash2 className='size-3.5' />
                    </IconButton>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!readOnly && value.length < MAX_FILES ? (
        <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
          <button
            type='button'
            data-track-category='automation-builder'
            data-track-name='send-message-create-template'
            onClick={openNewFileEditor}
            className='flex min-h-20 items-center justify-center gap-3 rounded-md border border-border px-4 py-3 text-left text-muted-foreground hover:border-foreground/30 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40'
          >
            <FileCode2 className='size-4' />
            <span className='flex flex-col'>
              <span className='text-sm font-medium text-foreground'>Create a file</span>
              <span className='text-[11px]'>Start a new text template</span>
            </span>
          </button>
          <button
            type='button'
            data-track-category='automation-builder'
            data-track-name='send-message-attach-template'
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
                ? 'border-amber-500 bg-amber-500/10 text-foreground'
                : 'border-border text-muted-foreground hover:border-foreground/30 hover:bg-accent/30',
            )}
          >
            {uploading ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Upload className='size-4' />
            )}
            <span className='flex flex-col'>
              <span className='text-sm font-medium text-foreground'>
                {uploading ? 'Uploading files…' : 'Upload files'}
              </span>
              <span className='text-[11px]'>Choose or drop .txt, .md, or .html</span>
            </span>
          </button>
        </div>
      ) : null}
      <input
        ref={inputRef}
        className='hidden'
        type='file'
        accept={ACCEPT}
        multiple
        onChange={event => void addFiles(Array.from(event.target.files ?? []))}
      />

      <Dialog
        open={editorSession !== null}
        onOpenChange={open => {
          if (!open && !editorSaving) setEditorSession(null);
        }}
        title={
          editorSession?.kind === 'existing'
            ? `Edit ${editorSession.attachment.originalFilename}`
            : 'Create file template'
        }
        description='Insert automation variables into the file template.'
        className='!h-[92vh] !w-[96vw] !max-w-[1440px] overflow-hidden'
        onPointerDownOutside={event => {
          if (editorSaving) event.preventDefault();
        }}
      >
        <div className='flex h-full min-h-0 flex-col'>
          <div className='flex items-start justify-between gap-4 border-b border-border px-5 py-4'>
            <div>
              <h2 className='text-sm font-semibold text-foreground'>
                {editorSession?.kind === 'existing'
                  ? editorSession.attachment.originalFilename
                  : 'Create a file template'}
              </h2>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                Insert values from the trigger or an earlier step. The source used by existing runs
                stays unchanged.
              </p>
            </div>
            <IconButton
              label='Close editor'
              onClick={() => setEditorSession(null)}
              disabled={editorSaving}
            >
              <X className='size-4' />
            </IconButton>
          </div>
          <div className='flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2'>
            {editorSession?.kind === 'new' ? (
              <div className='flex min-w-0 items-center gap-3'>
                <label className='flex min-w-0 items-center gap-2'>
                  <span className='shrink-0 text-xs font-medium text-muted-foreground'>
                    File name
                  </span>
                  <input
                    data-track-category='automation-builder'
                    data-track-name='template-editor-file-name'
                    value={getBasename(editorSession.filename)}
                    onChange={event =>
                      setEditorSession({
                        kind: 'new',
                        filename: `${event.target.value}${getExtension(editorSession.filename)}`,
                      })
                    }
                    spellCheck={false}
                    className='h-8 w-80 min-w-0 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-foreground/20'
                    aria-label='New file name'
                  />
                </label>
                <label className='flex shrink-0 items-center gap-2'>
                  <span className='text-xs font-medium text-muted-foreground'>File type</span>
                  <select
                    data-track-category='automation-builder'
                    data-track-name='template-editor-file-type'
                    value={getExtension(editorSession.filename)}
                    onChange={event =>
                      setEditorSession({
                        kind: 'new',
                        filename: `${getBasename(editorSession.filename)}${event.target.value}`,
                      })
                    }
                    className='h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-foreground/20'
                    aria-label='New file type'
                  >
                    <option value='.txt'>Plain text (.txt)</option>
                    <option value='.md'>Markdown (.md)</option>
                    <option value='.html'>HTML (.html)</option>
                  </select>
                </label>
              </div>
            ) : (
              <span className='flex-1 font-mono text-[11px] text-muted-foreground'>
                {'{{context.step.output.field}}'}
              </span>
            )}
            <Popover
              open={variableOpen}
              onOpenChange={setVariableOpen}
              align='end'
              side='bottom'
              sideOffset={4}
              className='overflow-hidden rounded-xl p-0'
              trigger={
                <button
                  type='button'
                  data-track-category='automation-builder'
                  data-track-name='template-editor-insert-variable'
                  disabled={editorLoading}
                  className='flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-foreground hover:bg-accent'
                >
                  <Variable className='size-3.5' />
                  Insert variable
                </button>
              }
            >
              <VariablePicker
                sources={variableSources}
                onSelect={entry => {
                  insertVariable(entry.reference);
                  setVariableOpen(false);
                }}
                onClose={() => setVariableOpen(false)}
              />
            </Popover>
          </div>
          <div className='min-h-0 flex-1 p-4'>
            {editorLoading ? (
              <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
                <Loader2 className='mr-2 size-4 animate-spin' /> Loading file…
              </div>
            ) : (
              <div className='grid h-full min-h-0 grid-cols-1 overflow-hidden rounded-md border border-border lg:grid-cols-2'>
                <section className='flex min-h-[320px] min-w-0 flex-col lg:min-h-0 lg:border-r lg:border-border'>
                  <PaneHeader icon={<Code2 className='size-3.5' />} label='Editor' />
                  <textarea
                    data-track-category='automation-builder'
                    data-track-name='template-editor-content'
                    ref={editorRef}
                    value={editorContent}
                    onChange={event => setEditorContent(event.target.value)}
                    spellCheck={false}
                    className='min-h-0 flex-1 resize-none bg-background p-5 font-mono text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-inset focus:ring-foreground/20'
                  />
                </section>
                <section className='flex min-h-[320px] min-w-0 flex-col border-t border-border lg:min-h-0 lg:border-t-0'>
                  <PaneHeader icon={<FileText className='size-3.5' />} label='Preview' />
                  <TemplatePreview
                    filename={
                      editorSession?.kind === 'new'
                        ? editorSession.filename
                        : (editorSession?.attachment.originalFilename ?? 'template.txt')
                    }
                    content={editorContent}
                  />
                </section>
              </div>
            )}
          </div>
          <div className='flex items-center justify-end gap-2 border-t border-border px-5 py-3'>
            <button
              type='button'
              data-track-category='automation-builder'
              data-track-name='template-editor-cancel'
              disabled={editorSaving}
              onClick={() => setEditorSession(null)}
              className='h-9 rounded-md border border-border px-3 text-sm text-foreground hover:bg-accent disabled:opacity-50'
            >
              Cancel
            </button>
            <button
              type='button'
              data-track-category='automation-builder'
              data-track-name='template-editor-apply'
              disabled={editorLoading || editorSaving}
              onClick={() => void saveEditor()}
              className='flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm text-background hover:opacity-90 disabled:opacity-50'
            >
              {editorSaving ? <Loader2 className='size-3.5 animate-spin' /> : null}
              {editorSession?.kind === 'new' ? 'Create and attach' : 'Apply changes'}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

async function releaseTemplate(attachmentId: string): Promise<void> {
  try {
    await releaseAutomationTemplate(attachmentId);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not release the file');
  }
}

function PaneHeader({ icon, label }: { icon: React.ReactNode; label: string }): React.ReactElement {
  return (
    <div className='flex h-10 shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-4 text-xs font-medium text-muted-foreground'>
      {icon}
      {label}
    </div>
  );
}

function TemplatePreview({
  filename,
  content,
}: {
  filename: string;
  content: string;
}): React.ReactElement {
  const extension = getExtension(filename);

  if (content.length === 0) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground'>
        Start typing to preview this file.
      </div>
    );
  }

  if (extension === '.html') {
    return (
      <iframe
        title='HTML file preview'
        sandbox=''
        srcDoc={DOMPurify.sanitize(content, { WHOLE_DOCUMENT: true })}
        className='min-h-0 flex-1 bg-white'
      />
    );
  }

  if (extension === '.md') {
    return (
      <div className='min-h-0 flex-1 overflow-auto bg-background p-6 text-sm text-foreground'>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, href }) => (
              <a
                href={href}
                target='_blank'
                rel='noreferrer'
                className='text-blue-600 underline underline-offset-2'
              >
                {children}
              </a>
            ),
            blockquote: ({ children }) => (
              <blockquote className='my-4 border-l-2 border-border pl-4 text-muted-foreground'>
                {children}
              </blockquote>
            ),
            code: ({ children }) => (
              <code className='rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]'>
                {children}
              </code>
            ),
            h1: ({ children }) => <h1 className='mb-4 text-2xl font-semibold'>{children}</h1>,
            h2: ({ children }) => <h2 className='mb-3 mt-6 text-xl font-semibold'>{children}</h2>,
            h3: ({ children }) => <h3 className='mb-2 mt-5 text-lg font-semibold'>{children}</h3>,
            ol: ({ children }) => <ol className='my-3 list-decimal pl-6'>{children}</ol>,
            p: ({ children }) => <p className='my-3 leading-6'>{children}</p>,
            pre: ({ children }) => (
              <pre className='my-4 overflow-auto rounded-md bg-muted p-4'>{children}</pre>
            ),
            table: ({ children }) => (
              <table className='my-4 w-full border-collapse text-left'>{children}</table>
            ),
            td: ({ children }) => <td className='border border-border p-2'>{children}</td>,
            th: ({ children }) => (
              <th className='border border-border bg-muted p-2 font-medium'>{children}</th>
            ),
            ul: ({ children }) => <ul className='my-3 list-disc pl-6'>{children}</ul>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <pre className='min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-background p-5 font-mono text-sm leading-6 text-foreground'>
      {content}
    </pre>
  );
}

function IconButton({
  label,
  onClick,
  disabled = false,
  forceInteractive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  forceInteractive?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type='button'
      data-track-category='automation-builder'
      data-track-name='template-attachment-action'
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40',
        forceInteractive && 'pointer-events-auto',
      )}
    >
      {children}
    </button>
  );
}

function validateFiles(incoming: File[], existing: AutomationTemplateAttachment[]): string | null {
  if (incoming.length === 0) return 'Choose at least one file';
  if (existing.length + incoming.length > MAX_FILES) return `Maximum ${MAX_FILES} files allowed`;
  for (const file of incoming) {
    const dot = file.name.lastIndexOf('.');
    const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return `${file.name}: only .txt, .md, and .html are allowed`;
    }
    if (file.size > MAX_FILE_BYTES) return `${file.name}: maximum file size is 10MB`;
  }
  const total =
    existing.reduce((sum, file) => sum + file.size, 0) +
    incoming.reduce((sum, file) => sum + file.size, 0);
  return total > MAX_TOTAL_BYTES ? 'Total attachment size cannot exceed 25MB' : null;
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function getBasename(filename: string): string {
  const extension = getExtension(filename);
  return extension.length > 0 ? filename.slice(0, -extension.length) : filename;
}

function getMimetype(filename: string): string | null {
  const extension = getExtension(filename);
  if (extension === '.txt') return 'text/plain';
  if (extension === '.md') return 'text/markdown';
  if (extension === '.html') return 'text/html';
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
