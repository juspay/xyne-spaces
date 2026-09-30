import { useEffect, useRef, type ReactElement } from 'react';
import { AIComposer } from '@/components/AIScreen/AIComposer';
import { AgentBotAvatar } from '@/components/agents/AgentBotAvatar';
import { CreateEmptyState } from './CreateEmptyState';
import type { AgentCreateFormState } from './types';
import { useDraftChat } from './useDraftChat';

interface AgentDraftChatPanelProps {
  getForm: () => AgentCreateFormState;
  disabled?: boolean;
}

/** Talk to the agent being built, using the current unsaved form. */
export function AgentDraftChatPanel({ getForm, disabled }: AgentDraftChatPanelProps): ReactElement {
  const { messages, pending, send, stop, clear } = useDraftChat(getForm);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <div className='flex h-full min-h-0 flex-col' data-component='AgentDraftChatPanel'>
      <div className='flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-2'>
        {messages.length === 0 ? (
          <CreateEmptyState
            media={
              <AgentBotAvatar type='clover' agentKey={getForm().slug || getForm().name} size={64} />
            }
            title='Try out your agent'
          />
        ) : (
          <ul className='flex flex-col gap-3 pb-3'>
            {messages.map(message => (
              <li key={message.id} className='px-1'>
                {message.role === 'user' ? (
                  <p className='whitespace-pre-wrap text-sm leading-6 text-foreground'>
                    {message.content}
                  </p>
                ) : (
                  <div className='flex flex-col gap-1'>
                    {message.streaming && message.content.length === 0 && !message.error ? (
                      <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'>
                        <AgentBotAvatar type='clover' busy size={22} />
                        Thinking
                      </span>
                    ) : (
                      <p className='whitespace-pre-wrap text-sm leading-6 text-foreground'>
                        {message.content}
                      </p>
                    )}
                    {message.error ? (
                      <p className='text-sm leading-5 text-destructive' role='alert'>
                        {message.error}
                      </p>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>
      {messages.length > 0 ? (
        <div className='flex justify-end px-3'>
          <button
            type='button'
            onClick={() => {
              void clear();
            }}
            className='text-xs text-muted-foreground hover:text-foreground'
            data-track-category='Claw Agents'
            data-track-name='Create agent: clear draft chat'
          >
            Clear chat
          </button>
        </div>
      ) : null}
      <div className='flex-shrink-0 px-[11px] pb-[11px]'>
        <AIComposer
          appearance='create'
          placeholder='Message this agent...'
          hideDisclaimer
          showAgentSelector={false}
          pending={pending}
          onStop={stop}
          onSubmit={text => {
            if (disabled) return;
            void send(text);
          }}
        />
      </div>
    </div>
  );
}
