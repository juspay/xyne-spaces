import { useEffect, useRef, useState, useCallback, type ReactElement, type ReactNode } from 'react';
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  type Editor,
  type Extensions,
} from '@tiptap/react';
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
import { Quote } from 'lucide-react';
import { EmailEditorToolbar } from './EmailEditorToolbar';
import { TableExtensions } from '../../ui/TipTapExtensions';
import { FormattingShortcutsExtension } from '../../ui/TipTapExtensions';
import { InlineImageNodeView } from './InlineImageNodeView';
import { CitationMark, getCitationRefFromTarget } from '../../ui/TipTapExtensions/CitationMark';

interface SelectionPopoverState {
  text: string;
  top: number;
  left: number;
}

const normalizeSelectedText = (text: string): string => text.replace(/\s+/g, ' ').trim();

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
  onBlur?: () => void;
  onFocus?: () => void;
  onEditorReady?: (editor: Editor) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  footerSlot?: ReactNode;
  onCitationClick?: (ref: string) => void;
  onCitationOrderChange?: (orderedRefs: string[]) => void;
  toolbarRightSlot?: React.ReactNode;
  extraExtensions?: Extensions;
  /** Callback when user selects text and clicks "Refine selection" */
  onSelectionRefine?: (selectedText: string) => void;
  /** Whether to show the selection refine popover (default: false) */
  showSelectionRefine?: boolean;
  bubbleToolbar?: boolean;
  /** Called when an attachment is dropped into the editor to become an inline image. */
  onDropAttachmentIntoEditor?: (data: {
    attachmentId: string;
    name: string;
    mimeType: string;
  }) => void;
  /** Called after the editor handles an external file drop so the parent
   * composer can reset its drag overlay state. */
  onFileDropHandled?: () => void;
}

export const EmailEditor = ({
  value,
  onChange,
  onAddFiles,
  uploadAndInsertInlineImages,
  onBlur,
  onFocus,
  onEditorReady,
  placeholder = 'Compose email...',
  disabled = false,
  readOnly = false,
  className = '',
  footerSlot,
  onCitationClick,
  onCitationOrderChange,
  toolbarRightSlot,
  extraExtensions,
  onSelectionRefine,
  showSelectionRefine = false,
  bubbleToolbar = false,
  onDropAttachmentIntoEditor,
  onFileDropHandled,
}: EmailEditorProps): ReactElement => {
  const cb = useRef({
    onChange,
    onAddFiles,
    uploadAndInsertInlineImages,
    onBlur,
    onFocus,
    onEditorReady,
    onCitationClick,
    onSelectionRefine,
    onDropAttachmentIntoEditor,
    onFileDropHandled,
  });
  cb.current = {
    onChange,
    onAddFiles,
    uploadAndInsertInlineImages,
    onBlur,
    onFocus,
    onEditorReady,
    onCitationClick,
    onSelectionRefine,
    onDropAttachmentIntoEditor,
    onFileDropHandled,
  };
  const lastEmittedRef = useRef('');
  const containerRef = useRef<HTMLDivElement>(null);
  const editorContentRef = useRef<HTMLDivElement>(null);
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState | null>(null);

  const clearSelectionPopover = useCallback((): void => {
    setSelectionPopover(null);
  }, []);

  // Handle text selection for refine
  useEffect(() => {
    if (!showSelectionRefine) {
      clearSelectionPopover();
      return;
    }

    const handleSelectionChange = (): void => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        clearSelectionPopover();
        return;
      }

      const range = selection.getRangeAt(0);
      const selected = normalizeSelectedText(selection.toString());
      if (!selected) {
        clearSelectionPopover();
        return;
      }

      const containerElement = containerRef.current;
      const editorElement = editorContentRef.current;
      if (!containerElement || !editorElement) {
        clearSelectionPopover();
        return;
      }

      const commonAncestor = range.commonAncestorContainer;
      const selectionInsideEditor = editorElement.contains(
        commonAncestor.nodeType === Node.TEXT_NODE ? commonAncestor.parentNode : commonAncestor,
      );

      if (!selectionInsideEditor) {
        clearSelectionPopover();
        return;
      }

      const rect = range.getBoundingClientRect();
      const containerRect = containerElement.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        clearSelectionPopover();
        return;
      }

      setSelectionPopover({
        text: selected,
        top: Math.max(12, rect.top - containerRect.top - 44),
        left: Math.min(
          Math.max(12, rect.left - containerRect.left + rect.width / 2),
          Math.max(12, containerRect.width - 12),
        ),
      });
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [showSelectionRefine, clearSelectionPopover]);

  const handleRefineSelection = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectionPopover?.text) return;
      cb.current.onSelectionRefine?.(selectionPopover.text);
      clearSelectionPopover();
      // Clear browser selection
      window.getSelection()?.removeAllRanges();
    },
    [selectionPopover, clearSelectionPopover],
  );

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
        link: false,
      }),
      LinkExtension.extend({ inclusive: false }).configure({ openOnClick: false }),
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
      CitationMark,
      FormattingShortcutsExtension,
      ...TableExtensions,
      ...(extraExtensions ?? []),
    ],
    onCreate: ({ editor }) => {
      cb.current.onEditorReady?.(editor);
    },
    autofocus: 'end',
    content: value || '',
    editable: !disabled && !readOnly,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastEmittedRef.current = html;
      cb.current.onChange(html);
    },
    onBlur: () => cb.current.onBlur?.(),
    onFocus: () => cb.current.onFocus?.(),
    editorProps: {
      scrollThreshold: 0,
      scrollMargin: 16,
      attributes: {
        class:
          'tiptap email-composer-editor prose prose-sm dark:prose-invert max-w-none focus:outline-none px-4 py-3 min-h-full',
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
        const dt = event.dataTransfer;

        // Handle attachment-to-inline-image drops first.
        const inlineAtt = dt?.getData('application/x-xd-inline-attachment');
        if (inlineAtt) {
          try {
            const data = JSON.parse(inlineAtt) as {
              attachmentId: string;
              name: string;
              mimeType: string;
            };
            if (data.attachmentId) {
              event.preventDefault();
              cb.current.onDropAttachmentIntoEditor?.(data);
              return true;
            }
          } catch {
            // ignore malformed payload
          }
        }

        const files = Array.from(dt?.files ?? []);
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
        if (files.length > 0) {
          event.stopPropagation();
          cb.current.onFileDropHandled?.();
        }
        return files.length > 0;
      },
    },
  });

  // Push external value changes (AI accept, draft load, post-send clear).
  useEffect(() => {
    if (!editor || value === lastEmittedRef.current) return;
    editor.commands.setContent(value || '', { emitUpdate: false });
    const normalized = editor.getHTML();
    lastEmittedRef.current = normalized;
    cb.current.onChange(normalized);
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (event: MouseEvent): void => {
      const ref = getCitationRefFromTarget(event.target);
      if (!ref) return;
      event.preventDefault();
      event.stopPropagation();
      cb.current.onCitationClick?.(ref);
    };
    dom.addEventListener('click', handler, { capture: true });
    return (): void => {
      dom.removeEventListener('click', handler, { capture: true });
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const storage = (editor.storage as unknown as Record<string, unknown>)['citation'] as
      | { onRefsChange: ((refs: string[]) => void) | null }
      | undefined;
    if (!storage) return;
    storage.onRefsChange = onCitationOrderChange ?? null;
    return (): void => {
      storage.onRefsChange = null;
    };
  }, [editor, onCitationOrderChange]);

  useEffect(() => {
    editor?.setEditable(!disabled && !readOnly);
  }, [editor, disabled, readOnly]);

  return (
    <div ref={containerRef} className={`relative flex flex-col ${className}`}>
      {/* Selection refine popover */}
      {!bubbleToolbar && selectionPopover && showSelectionRefine && !disabled && !readOnly && (
        <div
          className='absolute z-20 -translate-x-1/2'
          style={{ top: selectionPopover.top, left: selectionPopover.left }}
        >
          <button
            type='button'
            onMouseDown={e => e.preventDefault()}
            onClick={handleRefineSelection}
            className='inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur hover:bg-muted transition-colors'
            data-track-category='YourDraft'
            data-track-name='RefineSelection'
          >
            <Quote size={12} className='text-red-500 dark:text-red-400' />
            <span>Refine selection</span>
          </button>
        </div>
      )}
      {bubbleToolbar ? (
        <EmailEditorToolbar editor={editor} rightSlot={toolbarRightSlot} bubble />
      ) : (
        <div className='flex-shrink-0 border-b border-border px-2 py-1 bg-muted/30'>
          <EmailEditorToolbar editor={editor} rightSlot={toolbarRightSlot} />
        </div>
      )}
      {/* Padding lives on the ProseMirror element (via editorProps class)
          so clicks anywhere in the visible area land on the editor and
          focus it natively — no wrapper-level click handler needed. */}
      <div ref={editorContentRef} className='flex-1 min-h-0 overflow-y-auto text-sm cursor-text'>
        <div className='flex flex-col min-h-full'>
          <EditorContent editor={editor} className='flex-1' />
          {footerSlot}
        </div>
      </div>
    </div>
  );
};
