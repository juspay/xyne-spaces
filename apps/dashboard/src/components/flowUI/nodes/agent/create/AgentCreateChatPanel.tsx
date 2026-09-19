import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { AIComposer } from '@/components/AIScreen/AIComposer';
import { AIEmptyState } from '@/components/AIScreen/AIEmptyState';
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
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [lines, sending, error]);

  const submit = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || sending || disabled) return;
    setError(null);
    const userLine: ChatLine = { id: `u-${Date.now()}`, role: 'user', text: trimmed };
    setLines(prev => [...prev, userLine]);
    try {
      const reply = await onSend(trimmed);
      if (reply) {
        setLines(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: reply }]);
      }
    } catch (err) {
      setError(clawErrorText(err, 'Could not draft from chat. Try again.'));
    }
  };

  const empty = lines.length === 0 && !sending && !error;

  return (
    <div
      className='flex h-full min-w-0 flex-col bg-background'
      data-component='AgentCreateChatPanel'
    >
      <div className='flex h-11 flex-shrink-0 items-center px-5'>
        <span className='text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground'>
          Chat
        </span>
      </div>
      <div className='flex-1 overflow-y-auto'>
        {empty ? (
          <div className='flex h-full min-h-[12rem] flex-col items-center justify-center px-6'>
            <AIEmptyState />
            <p
              className='mt-3 text-center text-sm leading-5 text-muted-foreground'
              data-testid='agent-create-empty-hint'
            >
              The canvas on the right is the agent.
            </p>
          </div>
        ) : (
          <ul className='flex flex-col pb-2'>
            {lines.map(line => (
              <li
                key={line.id}
                className={cn(
                  'group w-full',
                  line.role === 'user' ? 'flex justify-end px-2 py-3' : 'px-2 py-5',
                )}
              >
                {line.role === 'user' ? (
                  <div className='flex max-w-[78%] flex-col items-end'>
                    <div className='ai-user-bubble max-w-full rounded-3xl bg-[#ececec] px-4 py-2.5 text-sm leading-relaxed text-gray-900'>
                      <p className='whitespace-pre-wrap'>{line.text}</p>
                    </div>
                  </div>
                ) : (
                  <p className='whitespace-pre-wrap text-sm leading-relaxed text-foreground'>
                    {line.text}
                  </p>
                )}
              </li>
            ))}
            {sending ? (
              <li
                className='flex items-center gap-2 px-2 py-5 text-sm text-muted-foreground'
                data-testid='agent-create-chat-thinking'
              >
                <Loader2 className='size-4 animate-spin' aria-hidden />
                <span>Thinking…</span>
              </li>
            ) : null}
            {error ? (
              <li className='px-2 pb-4'>
                <p className='text-sm leading-5 text-destructive' role='alert'>
                  {error}
                </p>
              </li>
            ) : null}
            <div ref={bottomRef} />
          </ul>
        )}
        {empty && error ? (
          <p className='px-5 pb-3 text-sm leading-5 text-destructive' role='alert'>
            {error}
          </p>
        ) : null}
      </div>
      <div className='flex-shrink-0 px-3 pb-3 pt-1'>
        <AIComposer
          autoFocus
          placeholder='Ask anything'
          hideDisclaimer
          showAgentSelector={false}
          pending={sending}
          onSubmit={text => {
            void submit(text);
          }}
        />
      </div>
    </div>
  );
}
