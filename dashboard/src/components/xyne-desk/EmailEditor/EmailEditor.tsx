import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { useEditor, EditorContent, ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import FontFamily from '@tiptap/extension-font-family';
import TextAlign from '@tiptap/extension-text-align';
import { EmailEditorToolbar } from './EmailEditorToolbar';
import { TableExtensions } from '../../ui/TipTapExtensions';
import { InlineImageNodeView } from './InlineImageNodeView';

// Extend TipTap's SetImageOptions to include our custom dataAttId attribute
// which is registered via Image.extend() below.
declare module '@tiptap/extension-image' {
  interface SetImageOptions {
    dataAttId?: string | null;
  }
}

const InlineImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dataAttId: {
        default: null,
        parseHTML: el => el.getAttribute('data-att-id'),
        renderHTML: attrs => {
          const id = (attrs as { dataAttId?: string | null }).dataAttId;
          return id ? { 'data-att-id': id } : {};
        },
      },
      crossorigin: {
        default: 'use-credentials',
        parseHTML: el => el.getAttribute('crossorigin') || 'use-credentials',
        renderHTML: attrs => {
          const v = (attrs as { crossorigin?: string | null }).crossorigin;
          return v ? { crossorigin: v } : {};
        },
      },
      width: {
        default: null,
        parseHTML: el => {
          const w = el.getAttribute('width');
          if (w) return Number(w) || null;
          // Fall back to inline style width=Npx so paste-from-Gmail keeps size.
          const m = el.style?.width?.match(/^(\d+)px$/);
          return m ? Number(m[1]) : null;
        },
        renderHTML: attrs => {
          const w = (attrs as { width?: number | string | null }).width;
          if (w === null || w === undefined || w === '') return {};
          const num = typeof w === 'number' ? w : Number(w);
          if (!Number.isFinite(num)) return {};

          return { width: String(num) };
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(InlineImageNodeView);
  },
});

interface EmailEditorProps {
  value: string;
  onChange: (html: string) => void;
  onAddFiles?: (files: File[]) => void | Promise<void>;
  uploadAndInsertInlineImages?: (images: File[]) => void | Promise<void>;
  onSendShortcut?: () => void;
  onBlur?: () => void;
  onEditorReady?: (editor: Editor) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  footerSlot?: ReactNode;
}

export const EmailEditor = ({
  value,
  onChange,
  onAddFiles,
  uploadAndInsertInlineImages,
  onSendShortcut,
  onBlur,
  onEditorReady,
  placeholder = 'Compose email...',
  disabled = false,
  readOnly = false,
  className = '',
  footerSlot,
}: EmailEditorProps): ReactElement => {
  const cb = useRef({
    onChange,
    onAddFiles,
    uploadAndInsertInlineImages,
    onSendShortcut,
    onBlur,
    onEditorReady,
  });
  cb.current = {
    onChange,
    onAddFiles,
    uploadAndInsertInlineImages,
    onSendShortcut,
    onBlur,
    onEditorReady,
  };
  const lastEmittedRef = useRef('');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: { HTMLAttributes: { style: 'margin: 0 0 0.75em 0;' } },
        bulletList: {
          HTMLAttributes: {
            style: 'padding-left: 1.5em; margin: 0.5em 0; list-style-type: disc;',
          },
        },
        orderedList: {
          HTMLAttributes: {
            style: 'padding-left: 1.5em; margin: 0.5em 0; list-style-type: decimal;',
          },
        },
        blockquote: {
          HTMLAttributes: {
            style:
              'border-left: 3px solid #d0d7de; padding-left: 12px; margin: 0.5em 0; color: #57606a;',
          },
        },
        strike: {
          HTMLAttributes: {
            style: 'text-decoration: line-through;',
          },
        },
      }),
      LinkExtension.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      InlineImage.configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: {
          style: 'max-width: 100%; height: auto; vertical-align: middle;',
        },
      }),
      TextStyle,
      FontSize,
      Color.configure({
        types: ['textStyle'],
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Underline,
      FontFamily,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      ...TableExtensions,
    ],
    onCreate: ({ editor }) => {
      cb.current.onEditorReady?.(editor);
    },
    content: value || '',
    editable: !disabled && !readOnly,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastEmittedRef.current = html;
      cb.current.onChange(html);
    },
    onBlur: () => cb.current.onBlur?.(),
    editorProps: {
      scrollThreshold: 80,
      scrollMargin: 80,
      attributes: {
        class:
          'tiptap email-composer-editor prose prose-sm dark:prose-invert max-w-none focus:outline-none px-4 py-3 min-h-full',
      },
      handleKeyDown: (_view, event) => {
        if (
          event.key === 'Enter' &&
          (event.metaKey || event.ctrlKey) &&
          cb.current.onSendShortcut
        ) {
          event.preventDefault();
          cb.current.onSendShortcut();
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) return false;
        const images = files.filter(f => f.type.startsWith('image/'));
        const nonImages = files.filter(f => !f.type.startsWith('image/'));
        if (images.length > 0 && cb.current.uploadAndInsertInlineImages) {
          event.preventDefault();
          void cb.current.uploadAndInsertInlineImages(images);
        }
        if (nonImages.length > 0 && cb.current.onAddFiles) {
          event.preventDefault();
          void cb.current.onAddFiles(nonImages);
        }
        return files.length > 0;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
  });

  // Push external value changes (AI accept, draft load, post-send clear).
  useEffect(() => {
    if (!editor || value === lastEmittedRef.current) return;
    editor.commands.setContent(value || '', { emitUpdate: false });
    const normalized = editor.getHTML();
    lastEmittedRef.current = normalized;
    if (normalized !== value) cb.current.onChange(normalized);
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!disabled && !readOnly);
  }, [editor, disabled, readOnly]);

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div className='flex-shrink-0 border-b border-border px-2 py-1 bg-muted/30'>
        <EmailEditorToolbar editor={editor} />
      </div>
      {/* Padding lives on the ProseMirror element (via editorProps class)
          so clicks anywhere in the visible area land on the editor and
          focus it natively — no wrapper-level click handler needed. */}
      <div className='flex-1 min-h-0 overflow-y-auto text-sm cursor-text'>
        <div className='flex flex-col min-h-full'>
          <EditorContent editor={editor} className='flex-1' />
          {footerSlot}
        </div>
      </div>
    </div>
  );
};
