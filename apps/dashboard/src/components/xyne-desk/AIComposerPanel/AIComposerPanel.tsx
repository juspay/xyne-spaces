import { useState, useRef, useEffect, type ReactElement } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wand2,
  X,
  Sparkles,
  ArrowRight,
  AlignLeft,
  CheckCheck,
  Maximize2,
  Minimize2,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { XyneAIStar } from '../../icons/xyne-ai';

import type { AIRefineQuickAction } from '../../../hooks/useDeskAIDraft';

export interface AIQuickRewriteAction {
  id: AIRefineQuickAction;
  label: string;
  icon: React.ReactNode;
}

const QUICK_REWRITE_ACTIONS: ReadonlyArray<AIQuickRewriteAction> = [
  { id: 'polish', label: 'Polish', icon: <AlignLeft size={14} /> },
  { id: 'formalise', label: 'Formalize', icon: <CheckCheck size={14} /> },
  { id: 'elaborate', label: 'Elaborate', icon: <Maximize2 size={14} /> },
  { id: 'shorten', label: 'Shorten', icon: <Minimize2 size={14} /> },
];

interface AIComposerPanelProps {
  onAskAISubmit: (instruction: string) => void;
  onOpenAskAISidebar?: () => void;
  onClose: () => void;
  disabled?: boolean;
}

export const AIComposerPanel = ({
  onAskAISubmit,
  onOpenAskAISidebar,
  onClose,
  disabled = false,
}: AIComposerPanelProps): ReactElement => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = Math.max(80, Math.floor((containerRef.current?.clientHeight ?? 200) * 0.35));
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value]);

  const submitInput = (): void => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onAskAISubmit(trimmed);
    setValue('');
  };

  return (
    <motion.div
      ref={containerRef}
      className='flex flex-col h-full min-h-0'
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Top bar */}
      <div className='flex items-center justify-between px-3 py-2 flex-shrink-0'>
        <div className='flex items-center gap-2'>
          <div className='relative flex items-center justify-center w-5 h-5 rounded-md bg-red-400'>
            <Sparkles size={11} className='text-white' />
          </div>
          <span className='text-xs font-semibold text-foreground'>Ask AI</span>
        </div>
        <div className='flex items-center gap-0.5'>
          {onOpenAskAISidebar && (
            <button
              type='button'
              onClick={onOpenAskAISidebar}
              className='size-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
              aria-label='Open Ask AI sidebar'
              title='Open Ask AI sidebar'
              data-track-category='Support'
              data-track-name='OpenAskAISidebarFromComposer'
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <path d='M7 7h10v10' />
                <path d='M7 17 17 7' />
              </svg>
            </button>
          )}
          <button
            type='button'
            onClick={onClose}
            className='size-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
            aria-label='Close'
            data-track-category='Support'
            data-track-name='CloseAIComposerPanel'
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className='flex-1 min-h-0 overflow-auto px-3 pb-2'>
        <p className='text-[11px] text-muted-foreground mb-2'>
          The agent will search relevant documents, tickets, and messages to ground its answer.
        </p>
      </div>

      {/* Animated border input */}
      <div className='flex-shrink-0 px-3 pb-3'>
        <div className='xyne-ai-prompt-border-wrap'>
          <div className='rounded-full bg-background flex items-end gap-1.5 px-3.5 py-2'>
            <textarea
              ref={inputRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitInput();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onClose();
                }
              }}
              disabled={disabled}
              placeholder='What do you need?'
              rows={1}
              className='flex-1 bg-transparent text-sm outline-none resize-none leading-snug placeholder:text-muted-foreground/50 min-h-[20px] max-h-[120px] py-0.5'
              data-track-category='Support'
              data-track-name='AIComposerTextareaKeydown'
            />
            <button
              type='button'
              onClick={submitInput}
              disabled={disabled || !value.trim()}
              data-ph-capture-attribute-track-id='submit_ask_ai_instruction'
              className='p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0 mb-0.5'
              aria-label='Submit'
              data-track-category='Support'
              data-track-name='SubmitAskAIInstruction'
            >
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

interface AIRefineDropdownProps {
  onQuickRewrite: (action: AIRefineQuickAction) => void;
  onAskAI: () => void;
  onRerunDraft?: () => void;
  onSeeSources?: () => void;
  showSeeSources?: boolean;
  agentName?: string;
  disabled?: boolean;
  showQuickRewrite?: boolean;
}

export const AIRefineDropdown = ({
  onQuickRewrite,
  onAskAI,
  onRerunDraft,
  onSeeSources,
  showSeeSources = false,
  agentName,
  disabled = false,
  showQuickRewrite = true,
}: AIRefineDropdownProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !(target as HTMLElement).closest('.ai-refine-menu')
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [open]);

  return (
    <div className='relative'>
      <button
        ref={buttonRef}
        type='button'
        onClick={() => setOpen(prev => !prev)}
        disabled={disabled}
        className={`size-7 flex items-center justify-center rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          open
            ? 'bg-destructive/10 text-destructive'
            : 'text-primary hover:bg-destructive/10 hover:text-destructive'
        }`}
        aria-label='Refine'
        aria-expanded={open}
        data-track-category='Support'
        data-track-name='ToggleAIRefineDropdown'
      >
        <Wand2 size={14} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className='ai-refine-menu absolute bottom-full left-0 mb-1.5 z-50 w-52 rounded-xl border border-border bg-popover shadow-lg overflow-hidden'
            initial={{ opacity: 0, scale: 0.96, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ duration: 0.12 }}
          >
            {showQuickRewrite && (
              <>
                <div className='px-3 pt-2.5 pb-1'>
                  <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                    Quick rewrite
                  </p>
                </div>
                {QUICK_REWRITE_ACTIONS.map(action => (
                  <button
                    key={action.id}
                    type='button'
                    disabled={disabled}
                    onClick={() => {
                      onQuickRewrite(action.id);
                      setOpen(false);
                    }}
                    data-ph-capture-attribute-track-id='ai_quick_rewrite'
                    data-ph-capture-attribute-action={action.id}
                    className='w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50'
                    data-track-category='Support'
                    data-track-name='QuickRewrite'
                    data-track-metadata={JSON.stringify({ action: action.id })}
                  >
                    <span className='text-muted-foreground'>{action.icon}</span>
                    <span>{action.label}</span>
                  </button>
                ))}

                <div className='border-t border-border my-1' />
              </>
            )}

            <div className='px-3 pt-1 pb-1'>
              <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                Ask AI
              </p>
            </div>
            <button
              type='button'
              disabled={disabled}
              onClick={() => {
                onAskAI();
                setOpen(false);
              }}
              className='w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50'
              data-track-category='Support'
              data-track-name='OpenAskAIFromDropdown'
            >
              <span className='text-[#6276be]'>
                <XyneAIStar size={14} />
              </span>
              <span>Help me draft</span>
            </button>
            {onRerunDraft && (
              <button
                type='button'
                disabled={disabled}
                onClick={() => {
                  onRerunDraft();
                  setOpen(false);
                }}
                data-ph-capture-attribute-track-id='ai_rerun_draft'
                className='w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50'
                title={agentName ? `Rerun draft with ${agentName}` : 'Rerun draft'}
                data-track-category='Support'
                data-track-name='RerunDraftFromDropdown'
              >
                <span className='text-muted-foreground'>
                  <RefreshCw size={14} />
                </span>
                <span>Rerun draft</span>
              </button>
            )}
            {showSeeSources && onSeeSources && (
              <button
                type='button'
                disabled={disabled}
                onClick={() => {
                  onSeeSources();
                  setOpen(false);
                }}
                className='w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50'
                title='View sources in the AI sidebar'
                data-track-category='Support'
                data-track-name='SeeSourcesFromDropdown'
              >
                <span className='text-muted-foreground'>
                  <ExternalLink size={14} />
                </span>
                <span>See sources</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
