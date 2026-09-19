import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowUp } from '@xyne/icons';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { clawErrorText } from '@/services/claw/clawRequest';

interface ChatLine {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface AgentCreateChatPanelProps {
  sending: boolean;
  onSend: (text: string) => Promise<string | void>;
  disabled?: boolean;
}

export function AgentCreateChatPanel({
  sending,
  onSend,
  disabled,
}: AgentCreateChatPanelProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || sending || disabled) return;
    setDraft('');
    setError(null);
    const userLine: ChatLine = { id: `u-${Date.now()}`, role: 'user', text };
    setLines(prev => [...prev, userLine]);
    try {
      const reply = await onSend(text);
      if (reply) {
        setLines(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: reply }]);
      }
    } catch (err) {
      setError(clawErrorText(err, 'Could not draft from chat. Try again.'));
    }
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void submit();
  };

  return (
    <div
      className='flex h-full min-w-0 flex-col bg-background'
      data-component='AgentCreateChatPanel'
    >
      <div className='flex h-14 flex-shrink-0 items-center border-b border-border px-5'>
        <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
          Chat
        </span>
      </div>
      <div className='flex-1 overflow-y-auto px-5 py-4'>
        {lines.length === 0 ? (
          <p className='text-sm leading-5 text-muted-foreground'>
            No draft yet. Say what this agent should do, or edit the canvas.
          </p>
        ) : (
          <ul className='flex flex-col gap-4'>
            {lines.map(line => (
              <li key={line.id} className='flex flex-col gap-1'>
                <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                  {line.role === 'user' ? 'You' : 'Xyne'}
                </span>
                <p className='whitespace-pre-wrap text-sm leading-5 text-foreground'>{line.text}</p>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p className='mt-3 text-sm leading-5 text-destructive' role='alert'>
            {error}
          </p>
        ) : null}
      </div>
      <form onSubmit={handleSubmit} className='flex-shrink-0 border-t border-border p-3'>
        <div className='flex items-end gap-2 rounded-2xl border border-border bg-card p-1'>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={disabled}
            placeholder='Describe the agent, or fill in the canvas.'
            aria-label='Describe the agent'
            rows={2}
            data-track-category='Claw Agents'
            data-track-name='Create agent chat: composer'
            className='min-h-[44px] min-w-0 flex-1 resize-none bg-transparent p-2 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60'
          />
          <button
            type='submit'
            disabled={disabled || sending || !draft.trim()}
            aria-label='Send'
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity',
              (disabled || sending || !draft.trim()) && 'cursor-not-allowed opacity-40',
            )}
            data-track-category='Claw Agents'
            data-track-name='Create agent chat: send'
          >
            {sending ? (
              <Loader2 className='size-4 animate-spin' aria-hidden />
            ) : (
              <ArrowUp className='size-4' aria-hidden />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
