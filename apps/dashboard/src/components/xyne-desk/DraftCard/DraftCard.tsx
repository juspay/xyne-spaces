import {
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  X,
  Sparkles,
  Loader2,
  Square,
  Quote,
  ChevronDown,
  ChevronUp,
  Wand2,
  AlignLeft,
  CheckCheck,
  Maximize2,
  Minimize2,
  ExternalLink,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { RefineInput } from '../RefineInput/RefineInput';
import { aiMarkdownProseClassName } from '../../../utils/markdownStyles';
import { cn } from '../../../utils/classNames';
import type { AIRefineQuickAction } from '../../../hooks/useDeskAIDraft';
import { stripCitationBlock, stripCitationMarks } from '../../ui/TipTapExtensions/CitationMark';
import type { ToolInvocation } from '../../Chat/XyneAISidebar/utils/XyneAITypes';

// rehypeRaw turns raw HTML embedded in the draft markdown into real DOM nodes, so
// the rendered output MUST be sanitized — otherwise malicious HTML in draft content
// (e.g. `<iframe srcdoc="<script>…">`, which inherits the parent origin) executes as
// stored XSS. Starts from rehype-sanitize's safe defaults (drops iframe/script/etc.
// and restricts href/src to safe protocols) and re-allows `checked` so GFM task-list
// checkboxes still render their state.
const draftSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    input: [...(defaultSchema.attributes?.['input'] ?? []), 'checked'],
  },
};

const DRAFT_SELECTION_HIGHLIGHT_KEY = 'desk-ai-draft-selection';

const REFINE_PRESETS: ReadonlyArray<{
  id: AIRefineQuickAction;
  label: string;
  icon: ReactElement;
}> = [
  { id: 'polish', label: 'Polish', icon: <AlignLeft size={14} /> },
  { id: 'formalise', label: 'Formalize', icon: <CheckCheck size={14} /> },
  { id: 'elaborate', label: 'Elaborate', icon: <Maximize2 size={14} /> },
  { id: 'shorten', label: 'Shorten', icon: <Minimize2 size={14} /> },
];

interface DraftCardProps {
  draftContent: string;
  toolInvocations?: ToolInvocation[];
  isStreaming: boolean;
  onAccept: () => void;
  onReject: () => void;
  onRefine: (instruction: string, options?: { selectedText?: string }) => void;
  /** Apply a one-tap rewrite preset (Polish / Formalize / Elaborate / Shorten) to the draft. */
  onQuickRefine?: (action: AIRefineQuickAction) => void;
  /** Selected text for refinement (can come from AI Draft selection or external "Your Draft" selection) */
  selectedTextForRefine?: string;
  /** Clear the selected text for refinement */
  onClearSelectedText?: () => void;
  onCollapse?: () => void;
  /**
   * Open the user's draft-agent sidebar session where this draft's citations
   * live. When provided, a "See sources" button is shown beside Insert/Replace.
   */
  onSeeSources?: () => void;
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
  onQuickRefine,
  selectedTextForRefine,
  onClearSelectedText,
  onCollapse,
  onSeeSources,
}: DraftCardProps): ReactElement => {
  // Inline citations (the [clf-…] tokens / [1.1] chips) are intentionally
  // stripped from the draft body — sources now live only in the sources panel
  // (auto-draft) or the AI sidebar (rerun / help-me-write).
  const visibleDraftContent = useMemo(
    () => stripCitationMarks(stripCitationBlock(draftContent)),
    [draftContent],
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const selectedRangeRef = useRef<Range | null>(null);
  const refineInputRef = useRef<HTMLInputElement>(null);
  const refineMenuRef = useRef<HTMLDivElement>(null);
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState | null>(null);
  const [localSelectedText, setLocalSelectedText] = useState('');
  const [refineMenuOpen, setRefineMenuOpen] = useState(false);

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

  // Close the Refine ▾ menu on outside click.
  useEffect(() => {
    if (!refineMenuOpen) return;
    const onDocMouseDown = (event: MouseEvent): void => {
      if (!refineMenuRef.current?.contains(event.target as Node)) setRefineMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [refineMenuOpen]);

  // Keep the streaming draft pinned to the bottom of the card's scroll area.
  useEffect(() => {
    if (!isStreaming) return;
    const el = contentRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [draftContent, isStreaming]);

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
      className='relative flex flex-col h-full min-h-0 rounded-2xl border border-border bg-background overflow-hidden'
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
      <div className='flex flex-col h-full min-h-0'>
        <div className='flex items-center justify-between px-4 py-2.5 min-h-[3rem] flex-shrink-0 border-b border-border'>
          <div className='flex items-center gap-2.5'>
            <div
              className='relative flex items-center justify-center w-6 h-6 rounded-lg'
              style={{ background: '#F87171' }}
            >
              <Sparkles size={12} className='text-white' />
            </div>
            <span className='text-sm font-semibold text-foreground'>AI Draft</span>
            {isStreaming && <Loader2 size={12} className='animate-spin text-muted-foreground' />}
          </div>
          <div className='flex items-center gap-1'>
            {onCollapse && !isStreaming && (
              <button
                type='button'
                onClick={onCollapse}
                className='size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                aria-label='Collapse AI draft'
                title='Collapse (keeps the draft)'
                data-track-category='AIDraft'
                data-track-name='CollapseAIDraft'
              >
                <ChevronUp size={14} />
              </button>
            )}
            {isStreaming ? (
              <button
                type='button'
                onClick={onReject}
                className='inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors dark:hover:bg-red-950/40 dark:hover:text-red-400'
                aria-label='Stop generating'
                title='Stop generating'
                data-track-category='AIDraft'
                data-track-name='StopDraft'
              >
                <Square size={11} className='fill-current' />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type='button'
                onClick={onReject}
                className='size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                aria-label='Discard draft'
                title='Discard draft'
                data-track-category='AIDraft'
                data-track-name='RejectDraft'
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div
          ref={contentRef}
          className='px-4 py-3 flex-1 min-h-0 max-h-80 overflow-y-auto select-text selection:bg-red-400/30'
        >
          {visibleDraftContent ? (
            <div className={aiMarkdownProseClassName}>
              <Markdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeRaw, [rehypeSanitize, draftSanitizeSchema]]}
                urlTransform={url => url}
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target='_blank' rel='noopener noreferrer'>
                      {children}
                    </a>
                  ),
                }}
              >
                {visibleDraftContent}
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

        {!!selectedText && (
          <div className='px-4 pb-2 flex-shrink-0'>
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
              onSubmit={instruction => {
                onRefine(instruction, { selectedText });
              }}
              disabled={isStreaming}
              placeholder='Refine the selected text (e.g., make it warmer, clearer...)'
            />
          </div>
        )}

        <div className='flex items-center gap-1.5 px-3 py-2.5 border-t border-border flex-shrink-0'>
          <div className='relative' ref={refineMenuRef}>
            <button
              type='button'
              onClick={() => setRefineMenuOpen(open => !open)}
              disabled={isStreaming}
              className='inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
              aria-haspopup='menu'
              aria-expanded={refineMenuOpen}
              data-track-category='AIDraft'
              data-track-name='ToggleRefineMenu'
            >
              <Wand2 size={14} />
              <span>Refine</span>
              <ChevronDown size={13} />
            </button>
            {refineMenuOpen && (
              <div
                role='menu'
                className='absolute bottom-full left-0 mb-1.5 z-50 w-52 rounded-xl border border-border bg-popover shadow-lg overflow-hidden py-1'
              >
                {REFINE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    type='button'
                    role='menuitem'
                    disabled={!onQuickRefine}
                    onClick={() => {
                      onQuickRefine?.(preset.id);
                      setRefineMenuOpen(false);
                    }}
                    className='w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50'
                    data-track-category='AIDraft'
                    data-track-name='QuickRefine'
                    data-track-metadata={JSON.stringify({ action: preset.id })}
                  >
                    <span className='text-muted-foreground'>{preset.icon}</span>
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {onSeeSources && (
            <button
              type='button'
              onClick={onSeeSources}
              className='ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
              title='View sources in the AI sidebar'
              data-track-category='AIDraft'
              data-track-name='SeeSources'
            >
              <ExternalLink size={13} />
              See sources
            </button>
          )}
          <div className={cn('relative flex items-center', !onSeeSources && 'ml-auto')}>
            <button
              type='button'
              data-ph-capture-attribute-track-id='accept_ai_draft'
              onClick={onAccept}
              disabled={!draftContent || isStreaming}
              className='inline-flex items-center justify-center h-8 px-4 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
              aria-label='Insert the AI draft into your reply'
              title='Insert draft'
              data-track-category='AIDraft'
              data-track-name='AcceptDraft'
            >
              Insert
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
