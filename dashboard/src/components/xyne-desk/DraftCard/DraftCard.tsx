import {
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, X, Sparkles, Loader2, Square, Quote } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { RefineInput } from '../RefineInput/RefineInput';
import { aiMarkdownProseClassName } from '../../../utils/markdownStyles';
import { cn } from '../../../utils/classNames';

const DRAFT_SELECTION_HIGHLIGHT_KEY = 'desk-ai-draft-selection';

interface DraftCardProps {
  draftContent: string;
  isStreaming: boolean;
  onAccept: () => void;
  onReject: () => void;
  onRefine: (instruction: string, options?: { selectedText?: string }) => void;
  /** Selected text for refinement (can come from AI Draft selection or external "Your Draft" selection) */
  selectedTextForRefine?: string;
  /** Clear the selected text for refinement */
  onClearSelectedText?: () => void;
}

interface SelectionPopoverState {
  text: string;
  top: number;
  left: number;
}

const SELECTION_PREVIEW_LIMIT = 240;

const normalizeSelectedText = (text: string): string => text.replace(/\s+/g, ' ').trim();

const truncateSelectionPreview = (text: string): string =>
  text.length > SELECTION_PREVIEW_LIMIT
    ? `${text.slice(0, SELECTION_PREVIEW_LIMIT).trimEnd()}...`
    : text;

export const DraftCard = ({
  draftContent,
  isStreaming,
  onAccept,
  onReject,
  onRefine,
  selectedTextForRefine,
  onClearSelectedText,
}: DraftCardProps): ReactElement => {
  const contentRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const selectedRangeRef = useRef<Range | null>(null);
  const refineInputRef = useRef<HTMLInputElement>(null);
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState | null>(null);
  const [localSelectedText, setLocalSelectedText] = useState('');

  // Use external selectedTextForRefine if provided, otherwise use local state
  const selectedText = selectedTextForRefine || localSelectedText;
  const setSelectedText = (text: string): void => {
    setLocalSelectedText(text);
    // If there's an external clear function and we're clearing, call it too
    if (!text && onClearSelectedText) {
      onClearSelectedText();
    }
  };

  const clearPersistentHighlight = useCallback((): void => {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete(DRAFT_SELECTION_HIGHLIGHT_KEY);
    }
    selectedRangeRef.current = null;
  }, []);

  const applyPersistentHighlight = useCallback((): void => {
    if (!selectedRangeRef.current) return;
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    CSS.highlights.set(DRAFT_SELECTION_HIGHLIGHT_KEY, new Highlight(selectedRangeRef.current));
  }, []);

  const clearSelectionPopover = useCallback((): void => {
    setSelectionPopover(null);
  }, []);

  const clearSelectedText = useCallback((): void => {
    setLocalSelectedText('');
    if (onClearSelectedText) onClearSelectedText();
    clearPersistentHighlight();
    clearSelectionPopover();
  }, [clearPersistentHighlight, clearSelectionPopover, onClearSelectedText]);

  useEffect(() => {
    if (!draftContent || isStreaming) {
      clearSelectedText();
    }
  }, [draftContent, isStreaming, clearSelectedText]);

  // Focus the refine input when external selectedTextForRefine is set
  useEffect(() => {
    if (selectedTextForRefine) {
      setTimeout(() => {
        refineInputRef.current?.focus();
      }, 0);
    }
  }, [selectedTextForRefine]);

  useEffect(() => {
    const handleWindowSelectionChange = (): void => {
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

      const contentElement = contentRef.current;
      const cardElement = cardRef.current;
      if (!contentElement || !cardElement) {
        clearSelectionPopover();
        return;
      }

      const commonAncestor = range.commonAncestorContainer;
      const selectionInsideDraft = contentElement.contains(
        commonAncestor.nodeType === Node.TEXT_NODE ? commonAncestor.parentNode : commonAncestor,
      );

      if (!selectionInsideDraft) {
        clearSelectionPopover();
        return;
      }

      const rect = range.getBoundingClientRect();
      const cardRect = cardElement.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        clearSelectionPopover();
        return;
      }

      selectedRangeRef.current = range.cloneRange();
      setSelectionPopover({
        text: selected,
        top: Math.max(12, rect.top - cardRect.top - 44),
        left: Math.min(
          Math.max(12, rect.left - cardRect.left + rect.width / 2),
          Math.max(12, cardRect.width - 12),
        ),
      });
    };

    document.addEventListener('selectionchange', handleWindowSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleWindowSelectionChange);
      clearPersistentHighlight();
    };
  }, [clearSelectionPopover, clearPersistentHighlight]);

  useEffect(() => {
    if (!selectedText) {
      clearPersistentHighlight();
      return;
    }
    applyPersistentHighlight();
  }, [selectedText, applyPersistentHighlight, clearPersistentHighlight]);

  useEffect(() => {
    return () => clearPersistentHighlight();
  }, [clearPersistentHighlight]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const styleId = 'desk-ai-draft-selection-highlight-style';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `::highlight(${DRAFT_SELECTION_HIGHLIGHT_KEY}) { background: rgba(248, 113, 113, 0.35); color: inherit; border-radius: 4px; }`;
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, [clearSelectionPopover]);

  const selectedTextPreview = useMemo(() => truncateSelectionPreview(selectedText), [selectedText]);

  const handleRefineSelection = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectionPopover?.text) return;
      setSelectedText(selectionPopover.text);
      clearSelectionPopover();
      setTimeout(() => {
        refineInputRef.current?.focus();
      }, 0);
    },
    [selectionPopover, clearSelectionPopover],
  );

  return (
    <div
      ref={cardRef}
      className='relative rounded-2xl p-px overflow-hidden flex flex-col h-full min-h-0'
      style={{
        background: isStreaming
          ? 'linear-gradient(135deg, #FFB3B3, #FFCECE, #FFC0C0, #FFB3B3)'
          : 'linear-gradient(135deg, rgba(255,179,179,0.3), rgba(255,206,206,0.15), rgba(255,179,179,0.3))',
        backgroundSize: isStreaming ? '300% 300%' : '100% 100%',
        animation: isStreaming ? 'gradient-xy 3s ease infinite' : 'none',
      }}
    >
      {selectionPopover && !isStreaming && (
        <div
          className='absolute z-20 -translate-x-1/2'
          style={{ top: selectionPopover.top, left: selectionPopover.left }}
        >
          <button
            type='button'
            onMouseDown={e => e.preventDefault()}
            onClick={handleRefineSelection}
            className='inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur hover:bg-muted transition-colors'
            data-track-category='AIDraft'
            data-track-name='RefineSelection'
          >
            <Quote size={12} className='text-red-500 dark:text-red-400' />
            <span>Refine selection</span>
          </button>
        </div>
      )}
      <div className='rounded-[calc(1rem-1px)] bg-background/95 dark:bg-background/90 backdrop-blur-xl overflow-hidden flex flex-col h-full min-h-0'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-2.5 min-h-[3rem] flex-shrink-0'>
          <div className='flex items-center gap-2.5'>
            <div
              className='relative flex items-center justify-center w-6 h-6 rounded-lg'
              style={{ background: '#F87171' }}
            >
              <Sparkles size={12} className='text-white' />
            </div>
            <span className='text-sm font-bold text-foreground'>AI Draft</span>
            {isStreaming && <Loader2 size={12} className='animate-spin text-muted-foreground' />}
          </div>
          <div className='flex items-center gap-1'>
            {isStreaming ? (
              <button
                type='button'
                onClick={onReject}
                className='inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors'
                aria-label='Stop generating'
                title='Stop generating'
                data-track-category='AIDraft'
                data-track-name='StopDraft'
              >
                <Square size={11} className='fill-current' />
                <span>Stop</span>
              </button>
            ) : (
              <>
                <button
                  type='button'
                  onClick={onReject}
                  className='size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors'
                  aria-label='Reject draft'
                  title='Reject draft'
                  data-track-category='AIDraft'
                  data-track-name='RejectDraft'
                >
                  <X size={14} />
                </button>
                <button
                  type='button'
                  onClick={onAccept}
                  disabled={!draftContent}
                  className='size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-green-600 hover:bg-green-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                  aria-label='Accept draft'
                  title='Accept draft'
                  data-track-category='AIDraft'
                  data-track-name='AcceptDraft'
                >
                  <Check size={14} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Draft content */}
        <div
          ref={contentRef}
          className='px-4 py-3 flex-1 min-h-0 overflow-y-auto select-text selection:bg-red-400/30'
        >
          {draftContent ? (
            <div className={aiMarkdownProseClassName}>
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw]}>
                {draftContent}
              </Markdown>
              {isStreaming && (
                <span className='inline-block w-0.5 h-4 bg-foreground animate-pulse ml-0.5 align-text-bottom' />
              )}
            </div>
          ) : (
            <div className='text-sm text-muted-foreground italic leading-relaxed'>
              Generating draft...
              {isStreaming && (
                <span className='inline-block w-0.5 h-4 bg-foreground animate-pulse ml-0.5 align-text-bottom' />
              )}
            </div>
          )}
        </div>

        {/* Refine input - always present */}
        <div className='px-4 pb-3 flex-shrink-0'>
          {selectedText && (
            <div className='mb-2 rounded-xl border border-red-200/70 bg-red-50/60 px-3 py-2 text-left dark:border-red-900/60 dark:bg-red-950/20'>
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <div className='text-[11px] font-semibold uppercase tracking-[0.08em] text-red-700 dark:text-red-300'>
                    Refining selected text
                  </div>
                  <p className={cn('mt-1 text-sm text-foreground/90 break-words')}>
                    &ldquo;{selectedTextPreview}&rdquo;
                  </p>
                </div>
                <button
                  type='button'
                  onClick={clearSelectedText}
                  className='mt-0.5 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-100 hover:text-foreground transition-colors dark:hover:bg-red-900/40'
                  aria-label='Clear selected text'
                  title='Clear selected text'
                  data-track-category='AIDraft'
                  data-track-name='ClearSelectedText'
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          <RefineInput
            ref={refineInputRef}
            onSubmit={instruction =>
              onRefine(instruction, selectedText ? { selectedText } : undefined)
            }
            disabled={isStreaming}
            placeholder={
              selectedText
                ? 'Refine the selected text (e.g., make it warmer, clearer...)'
                : 'Refine: make it shorter, add context...'
            }
          />
        </div>
      </div>
    </div>
  );
};
