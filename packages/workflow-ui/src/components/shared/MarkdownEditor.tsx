import { useEffect, type ReactNode } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import { cn } from './cn.js';
import { Select } from './Select.js';

export interface MarkdownEditorProps {
  /** Current value as a markdown string. */
  value: string;
  /** Called with the new markdown string on every edit. */
  onChange: (markdown: string) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
  /** Drop the outer border/background so it sits flush inside a card body. */
  bare?: boolean | undefined;
  /** Store HTML instead of markdown (for fields read as HTML, e.g. a chat message). No headings. */
  html?: boolean | undefined;
  onBlur?: (() => void) | undefined;
  /** Called when `{{` is typed. */
  onBraces?: (() => void) | undefined;
  /** Hands the editor out so a caller can insert at the caret. */
  editorRef?: { current: Editor | null } | undefined;
}

const read = (e: Editor, html?: boolean) =>
  html ? (e.isEmpty ? '' : e.getHTML()) : ((e.storage as { markdown?: { getMarkdown(): string } }).markdown?.getMarkdown() ?? '');

/**
 * WYSIWYG markdown editor for runtime reviewer input (approval-form text fields).
 * You edit the rendered view directly; the stored value is markdown, so it
 * renders identically via {@link MarkdownView} wherever it's shown later.
 *
 * Formatting parity with the renderer: headings, bold, italic, strikethrough,
 * lists, links, inline code, code block, quote, divider. (Tables/images still
 * render if present in the value, but aren't authored here.)
 *
 * Builder/config fields deliberately do NOT use this — those carry typed values
 * and `{{variable}}` refs that markdown would mangle.
 */
export function MarkdownEditor({ value, onChange, disabled, className, bare, html, onBlur, onBraces, editorRef }: MarkdownEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: html ? false : { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      ...(html ? [] : [Markdown.configure({ html: false, linkify: true, breaks: true, transformPastedText: true })]),
    ],
    content: value || '',
    editable: !disabled,
    onUpdate: ({ editor }) => {
      onChange(read(editor, html));
      const at = editor.state.selection.from;
      if (editor.state.doc.textBetween(Math.max(0, at - 2), at) === '{{') onBraces?.();
    },
    onBlur: () => onBlur?.(),
    editorProps: {
      attributes: { class: 'min-h-[7rem] max-h-[28rem] resize-y overflow-y-auto px-2.5 py-2 outline-none' },
    },
  });

  // Sync external value changes (e.g. AI form-fill) without clobbering the
  // user's caret while they type — only when the value truly differs.
  useEffect(() => {
    if (!editor) return;
    if (value !== read(editor, html)) editor.commands.setContent(value || '', false);
  }, [value, editor, html]);

  useEffect(() => {
    if (editorRef) editorRef.current = editor;
  }, [editor, editorRef]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  return (
    <div
      className={cn(
        !bare && 'rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] focus-within:border-[var(--wui-primary)] focus-within:ring-1 focus-within:ring-[var(--wui-primary)]',
        disabled && 'opacity-60',
        // WYSIWYG content styling — mirrors MarkdownView so editing matches the render.
        'text-[13px] text-[var(--wui-fg)]',
        html && 'wui-message',
        '[&_.ProseMirror]:leading-relaxed',
        '[&_h1]:text-base [&_h1]:font-bold [&_h1]:my-2',
        '[&_h2]:text-sm [&_h2]:font-bold [&_h2]:my-1.5',
        '[&_h3]:text-[13px] [&_h3]:font-bold [&_h3]:my-1',
        '[&_p]:my-1.5',
        '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5',
        '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--wui-border-strong)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-[var(--wui-fg-muted)]',
        '[&_code]:rounded [&_code]:bg-[var(--wui-bg-muted)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]',
        '[&_pre]:my-2 [&_pre]:rounded-md [&_pre]:bg-[var(--wui-bg-muted)] [&_pre]:p-3 [&_pre]:text-[12px] [&_pre]:text-[var(--wui-fg)] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit',
        '[&_hr]:my-3 [&_hr]:border-[var(--wui-border)]',
        '[&_a]:text-[var(--wui-primary)] [&_a]:underline',
        className,
      )}
    >
      <MarkdownToolbar editor={editor} disabled={disabled} html={html} />
      <EditorContent editor={editor} />
    </div>
  );
}

const ICON = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function headingValue(editor: Editor): string {
  if (editor.isActive('heading', { level: 1 })) return 'h1';
  if (editor.isActive('heading', { level: 2 })) return 'h2';
  if (editor.isActive('heading', { level: 3 })) return 'h3';
  return 'p';
}

function MarkdownToolbar({ editor, disabled, html }: { editor: Editor | null; disabled?: boolean | undefined; html?: boolean | undefined }) {
  if (!editor) return null;

  const Item = ({ on, active, title, children }: { on: () => void; active?: boolean; title: string; children: ReactNode }) => (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-label={title}
      onMouseDown={(e) => { e.preventDefault(); on(); }}
      className={cn(
        'grid h-7 w-7 place-items-center rounded transition-colors',
        active
          ? 'bg-[var(--wui-primary)]/15 text-[var(--wui-primary)]'
          : 'text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]',
      )}
    >
      {children}
    </button>
  );
  const Divider = () => <span className="mx-0.5 h-4 w-px bg-[var(--wui-border)]" />;

  const setLink = () => {
    const prev = (editor.getAttributes('link')['href'] as string | undefined) ?? '';
    const url = window.prompt('Link URL', prev);
    if (url === null) return;
    const chain = editor.chain().focus().extendMarkRange('link');
    if (url === '') chain.unsetLink().run();
    else chain.setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--wui-border)] px-1.5 py-1">
      {/* Block type — headings are markdown-only */}
      {!html && <Select
        compact
        value={headingValue(editor)}
        options={[
          { value: 'p', label: 'Normal' },
          { value: 'h1', label: 'Heading 1' },
          { value: 'h2', label: 'Heading 2' },
          { value: 'h3', label: 'Heading 3' },
        ]}
        onChange={(v) => {
          const c = editor.chain().focus();
          if (v === 'p') c.setParagraph().run();
          else c.setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
        }}
        disabled={disabled}
        ariaLabel="Text style"
        className="mr-0.5 w-[92px]"
      />}
      {!html && <Divider />}

      <Item on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
        <span className="text-[13px] font-bold leading-none">B</span>
      </Item>
      <Item on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
        <span className="text-[13px] italic leading-none" style={{ fontFamily: 'Georgia, serif' }}>I</span>
      </Item>
      <Item on={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
        <span className="text-[13px] leading-none line-through">S</span>
      </Item>
      <Divider />

      <Item on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bulleted list">
        <svg {...ICON}><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" /></svg>
      </Item>
      <Item on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
        <svg {...ICON}><line x1="10" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="18" x2="20" y2="18" /><path d="M4 4.5h1V8" strokeWidth="1.75" /><path d="M3.6 14.2c0-.6.5-1 1-1s1 .4 1 .9c0 .9-1.6 1.2-1.9 2.4H5.8" strokeWidth="1.75" /></svg>
      </Item>
      <Divider />

      <Item on={setLink} active={editor.isActive('link')} title="Link">
        <svg {...ICON}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
      </Item>
      <Item on={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline code">
        <svg {...ICON}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
      </Item>
      <Item on={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
        <svg {...ICON}><rect x="3" y="4" width="18" height="16" rx="2" /><polyline points="9 9.5 7.5 12 9 14.5" /><polyline points="15 9.5 16.5 12 15 14.5" /></svg>
      </Item>
      <Divider />

      <Item on={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
        <svg {...ICON}><path d="M7 7H4v6h3l-1 4M17 7h-3v6h3l-1 4" /></svg>
      </Item>
      <Item on={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
        <svg {...ICON}><line x1="4" y1="12" x2="20" y2="12" /></svg>
      </Item>
    </div>
  );
}
