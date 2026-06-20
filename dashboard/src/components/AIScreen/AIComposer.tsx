import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { ArrowUp, Paperclip, Square } from 'lucide-react';
import { AIAgentSelector } from './AIAgentSelector';
import { cn } from '../../utils/classNames';

interface AIComposerProps {
  autoFocus?: boolean;
  onSubmit?: (text: string) => void;
  placeholder?: string;
  hideDisclaimer?: boolean;
  pending?: boolean;
  onStop?: () => void;
}

export function AIComposer({
  autoFocus,
  onSubmit,
  placeholder = 'Ask anything',
  pending = false,
  onStop,
  hideDisclaimer,
}: AIComposerProps): ReactElement {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow textarea
  useEffect((): void => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${String(Math.min(el.scrollHeight, 200))}px`;
  }, [value]);

  useEffect((): void => {
    if (autoFocus) {
      ref.current?.focus();
    }
  }, [autoFocus]);

  const submit = (): void => {
    if (pending) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit?.(trimmed);
    setValue('');
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = value.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className='relative'>
      <div
        className={cn(
          'ai-composer-wrapper group flex flex-col gap-1 rounded-3xl border border-[#c0bcb4] bg-[#f5f4f0] px-3 pb-2 pt-3 transition shadow-[0_1px_0_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.08)] focus-within:border-[#a09c94] focus-within:shadow-[0_1px_0_rgba(0,0,0,0.1),0_12px_30px_-12px_rgba(0,0,0,0.12)]',
        )}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className='min-h-[60px] resize-none bg-transparent px-2 py-1 text-[15px] leading-6 placeholder:text-muted-foreground/80 focus:outline-none'
          data-track-category='XyneAI'
          data-track-name='ComposerInput'
        />

        <div className='flex items-center justify-between gap-2'>
          <button
            type='button'
            aria-label='Attach file'
            title='Attach'
            className='inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground'
            data-track-category='XyneAI'
            data-track-name='ATTACH_FILE'
          >
            <Paperclip className='h-4 w-4' aria-hidden strokeWidth={1.75} />
          </button>

          <div className='flex items-center gap-3'>
            <AIAgentSelector disabled={pending} />

            {pending ? (
              <button
                type='button'
                onClick={onStop}
                aria-label='Stop generating'
                title='Stop'
                className='inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90'
                data-track-category='XyneAI'
                data-track-name='STOP_GENERATION'
              >
                <Square className='h-2.5 w-2.5 fill-current' aria-hidden strokeWidth={0} />
              </button>
            ) : (
              <button
                type='submit'
                disabled={!canSend}
                aria-label='Send'
                title='Send'
                className={cn(
                  'ai-send-btn inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e8e4dd] text-foreground transition enabled:hover:bg-[#ddd9d2] disabled:cursor-not-allowed disabled:bg-[#e8e4dd]/50 disabled:text-muted-foreground',
                )}
              >
                <ArrowUp className='h-4 w-4' aria-hidden strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
      </div>
      {hideDisclaimer ? null : (
        <p className='mt-2 text-center text-[11px] text-muted-foreground/80'>
          Xyne can make mistakes. Verify important details.
        </p>
      )}
    </form>
  );
}
