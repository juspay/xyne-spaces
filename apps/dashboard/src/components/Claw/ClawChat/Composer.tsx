import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';
import { MAX_TEXTAREA_HEIGHT_PX } from './clawChat.constants';

interface ComposerProps {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ isStreaming, onSend, onStop }: ComposerProps): ReactElement {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return (): void => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, [value]);

  const handleSubmit = (): void => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = value.trim().length > 0 && !isStreaming;

  return (
    <div className='shrink-0 border-t border-border p-2'>
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl border border-input bg-background px-2.5 py-2',
          'focus-within:ring-2 focus-within:ring-ring/50',
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Ask Claw...'
          rows={1}
          data-track-category='CLAW_CHAT'
          data-track-name='COMPOSER_INPUT'
          className={cn(
            'flex-1 resize-none bg-transparent text-sm text-foreground outline-none',
            'placeholder:text-muted-foreground max-h-32',
          )}
        />
        {isStreaming ? (
          <button
            type='button'
            onClick={onStop}
            aria-label='Stop generating'
            data-track-category='CLAW_CHAT'
            data-track-name='STOP_GENERATION'
            className='flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent transition-colors'
          >
            <Square className='size-3 fill-current' />
          </button>
        ) : (
          <Button
            variant='ghost'
            type='button'
            onClick={handleSubmit}
            disabled={!canSend}
            aria-label='Send message'
            trackId='claw_send_message'
            data-track-category='CLAW_CHAT'
            data-track-name='SEND_MESSAGE'
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
              canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            <ArrowUp className='size-4' />
          </Button>
        )}
      </div>
    </div>
  );
}
