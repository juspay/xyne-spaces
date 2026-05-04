import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Sparkles, X, ArrowRight } from 'lucide-react';

export interface RephraseQuickAction {
  label: string;
  instruction: string;
}

interface RephrasePromptProps {
  onSubmit: (instruction: string) => void;
  onClose: () => void;
  disabled?: boolean;
  title?: string;
  placeholder?: string;
  quickActions?: ReadonlyArray<RephraseQuickAction>;
}

const DEFAULT_QUICK_ACTIONS: ReadonlyArray<RephraseQuickAction> = [
  { label: 'Formalize', instruction: 'Make it more formal and professional.' },
  { label: 'Shorten', instruction: 'Make it more concise without losing meaning.' },
  { label: 'Elaborate', instruction: 'Expand with more detail and context.' },
  { label: 'Rephrase', instruction: 'Rephrase it while keeping the same meaning.' },
  { label: 'Fix grammar', instruction: 'Fix grammar and spelling without changing tone.' },
];

export const RephrasePrompt = ({
  onSubmit,
  onClose,
  disabled = false,
  title = 'What would you like to do with this text?',
  placeholder = 'Or describe how to change it…',
  quickActions = DEFAULT_QUICK_ACTIONS,
}: RephrasePromptProps): ReactElement => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (instruction: string): void => {
    const trimmed = instruction.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
  };

  return (
    // Red-coral chrome shared with the AI Summary panel and the DraftCard
    // — keeps every AI surface in the desk on the same palette.
    <div
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
          <button
            type='button'
            onClick={onClose}
            className='size-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
            aria-label='Close rephrase prompt'
            data-track-category='AIDraft'
            data-track-name='CloseRephrasePrompt'
          >
            <X size={14} />
          </button>
        </div>

        {/* Quick-action chips fill the available space; the custom input is
            pinned to the bottom of the card so it stays grounded as a
            composer-style entry point. */}
        <div className='px-4 py-3 flex flex-wrap gap-1.5 flex-1 min-h-0 content-start overflow-y-auto'>
          {quickActions.map(opt => (
            <button
              key={opt.label}
              type='button'
              disabled={disabled}
              onClick={() => submit(opt.instruction)}
              className='text-xs px-2.5 py-1 rounded-full border border-border bg-background text-foreground hover:border-red-300 hover:bg-red-50/70 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-start'
              data-track-category='AIDraft'
              data-track-name='RephraseQuickAction'
              data-track-metadata={JSON.stringify({ label: opt.label })}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div
          className='px-4 pb-3 pt-2 flex-shrink-0'
          style={{ borderTop: '1px solid rgba(248,113,113,0.35)' }}
        >
          <div className='relative'>
            <input
              ref={inputRef}
              type='text'
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit(value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onClose();
                }
              }}
              disabled={disabled}
              placeholder={placeholder}
              className='w-full text-sm border border-border rounded-lg bg-background pl-3 pr-9 py-2 outline-none focus:border-red-300 placeholder:text-muted-foreground/60 disabled:opacity-50'
              data-track-category='AIDraft'
              data-track-name='RephraseCustomInput'
            />
            <button
              type='button'
              onClick={() => submit(value)}
              disabled={disabled || !value.trim()}
              className='absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
              aria-label='Submit rephrase instruction'
              data-track-category='AIDraft'
              data-track-name='SubmitRephrase'
            >
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
