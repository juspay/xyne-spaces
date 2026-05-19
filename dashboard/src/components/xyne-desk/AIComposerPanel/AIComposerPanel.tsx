import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Sparkles, X, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { AIRefineQuickAction } from '../../../hooks/useDeskAIDraft';

export interface AIQuickRewriteAction {
  id: AIRefineQuickAction;
  label: string;
}

export type AIComposerPanelMode = 'quick-rewrite' | 'ask-ai';

interface AIComposerPanelProps {
  mode: AIComposerPanelMode;
  onQuickRewrite: (action: AIRefineQuickAction) => void;
  onCustomRewrite: (instruction: string) => void;
  onAskAISubmit: (instruction: string) => void;
  onOpenAskAISidebar?: () => void;
  onClose: () => void;
  disabled?: boolean;
  quickRewriteActions?: ReadonlyArray<AIQuickRewriteAction>;
}

const DEFAULT_QUICK_REWRITE_ACTIONS: ReadonlyArray<AIQuickRewriteAction> = [
  { id: 'formalise', label: 'Formalize' },
  { id: 'shorten', label: 'Shorten' },
  { id: 'elaborate', label: 'Elaborate' },
  { id: 'polish', label: 'Polish' },
];

export const AIComposerPanel = ({
  mode,
  onQuickRewrite,
  onCustomRewrite,
  onAskAISubmit,
  onOpenAskAISidebar,
  onClose,
  disabled = false,
  quickRewriteActions = DEFAULT_QUICK_REWRITE_ACTIONS,
}: AIComposerPanelProps): ReactElement => {
  const [value, setValue] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isAskAI = mode === 'ask-ai';
  const [customInputVisible, setCustomInputVisible] = useState(false);
  const showInput = isAskAI || customInputVisible;

  useEffect(() => {
    setCustomInputVisible(false);
    setValue('');
  }, [mode]);

  useEffect(() => {
    if (showInput) inputRef.current?.focus();
  }, [showInput]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const panelHeight = panelRef.current?.clientHeight ?? 0;
    const maxHeight = Math.max(80, Math.floor(panelHeight * 0.3));
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, showInput]);

  const submitInput = (): void => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    if (isAskAI) {
      onAskAISubmit(trimmed);
    } else {
      onCustomRewrite(trimmed);
    }
    setValue('');
  };

  const title = isAskAI ? 'Ask AI' : 'Quick rewrite';

  const placeholder = isAskAI
    ? 'Ask AI to do something with full context…'
    : 'Describe how to rewrite the text…';

  return (
    <div
      ref={panelRef}
      className='rounded-2xl p-[1.5px] overflow-hidden flex flex-col h-full min-h-0'
      style={{
        background:
          'linear-gradient(135deg, rgba(248,113,113,0.5), rgba(252,165,165,0.3), rgba(248,113,113,0.5))',
      }}
    >
      <div className='rounded-[calc(1rem-1.5px)] bg-background/95 dark:bg-background/90 backdrop-blur-xl overflow-hidden flex flex-col h-full min-h-0'>
        <div className='flex items-center justify-between px-4 py-2.5 min-h-[3rem] flex-shrink-0'>
          <div className='flex items-center gap-2.5'>
            <div
              className='relative flex items-center justify-center w-6 h-6 rounded-lg'
              style={{ background: '#F87171' }}
            >
              <Sparkles size={12} className='text-white' />
            </div>
            <span className='text-sm font-bold text-foreground'>{title}</span>
          </div>
          <div className='flex items-center gap-0.5'>
            {onOpenAskAISidebar && (
              <button
                type='button'
                onClick={onOpenAskAISidebar}
                className='size-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                aria-label='Open Ask AI sidebar'
                title='Open Ask AI sidebar'
                data-track-category='AIDraft'
                data-track-name='OpenAskAISidebarFromPanel'
              >
                <ArrowUpRight size={14} />
              </button>
            )}
            <button
              type='button'
              onClick={onClose}
              className='size-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
              aria-label='Close AI panel'
              data-track-category='AIDraft'
              data-track-name='CloseAIPanel'
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Quick-rewrite chips — only shown in quick-rewrite mode. The
            preset chips fire an instant pure-LLM rewrite; the trailing
            "Custom…" chip reveals an input below for a user-typed
            rewrite instruction (also pure LLM). Ask-AI mode has its
            own input and doesn't need chips. */}
        {!isAskAI && (
          <div className='px-4 py-3 flex flex-wrap gap-1.5 flex-shrink-0 content-start'>
            {quickRewriteActions.map(opt => (
              <button
                key={opt.id}
                type='button'
                disabled={disabled}
                onClick={() => onQuickRewrite(opt.id)}
                className='text-xs px-2.5 py-1 rounded-full border border-border bg-background text-foreground hover:border-red-300 hover:bg-red-50/70 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-start'
                data-track-category='AIDraft'
                data-track-name='QuickRewriteAction'
                data-track-metadata={JSON.stringify({ label: opt.label })}
              >
                {opt.label}
              </button>
            ))}
            {!customInputVisible && (
              <button
                type='button'
                disabled={disabled}
                onClick={() => setCustomInputVisible(true)}
                className='text-xs px-2.5 py-1 rounded-full border border-border bg-background text-foreground hover:border-red-300 hover:bg-red-50/70 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-start'
                data-track-category='AIDraft'
                data-track-name='RevealCustomRewriteInput'
              >
                Custom…
              </button>
            )}
          </div>
        )}

        {!showInput && <div className='flex-1 min-h-0' />}

        {showInput && (
          <>
            <div className='flex-1 min-h-0' />
            <div
              className='px-4 pb-3 pt-2 flex-shrink-0'
              style={{ borderTop: '1px solid rgba(248,113,113,0.35)' }}
            >
              <div className='relative'>
                <textarea
                  ref={inputRef}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  onKeyDown={e => {
                    // Enter submits; Shift+Enter inserts a newline.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitInput();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      onClose();
                    }
                  }}
                  disabled={disabled}
                  placeholder={placeholder}
                  rows={1}
                  className='w-full text-sm border border-border rounded-lg bg-background pl-3 pr-9 py-2 outline-none focus:border-red-300 placeholder:text-muted-foreground/60 disabled:opacity-50 resize-none leading-snug'
                  data-track-category='AIDraft'
                  data-track-name={isAskAI ? 'AskAICustomInput' : 'CustomRewriteInput'}
                />
                <button
                  type='button'
                  onClick={submitInput}
                  disabled={disabled || !value.trim()}
                  className='absolute right-1 top-[18px] -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                  aria-label={isAskAI ? 'Submit Ask AI instruction' : 'Submit custom rewrite'}
                  data-track-category='AIDraft'
                  data-track-name={isAskAI ? 'SubmitAskAI' : 'SubmitCustomRewrite'}
                >
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
