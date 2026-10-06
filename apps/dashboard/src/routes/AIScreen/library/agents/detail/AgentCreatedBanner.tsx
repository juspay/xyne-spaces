import { useEffect, type ReactElement } from 'react';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { useOpenAgentChat } from '@/hooks/useOpenAgentChat';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';

const VISIBLE_MS = 20_000;

interface AgentCreatedBannerProps {
  agent: Agent;
  pendingRegistration: boolean;
  onDismiss: () => void;
}

export function AgentCreatedBanner({
  agent,
  pendingRegistration,
  onDismiss,
}: AgentCreatedBannerProps): ReactElement {
  const { canOpenAgentChat, openAgentChat } = useOpenAgentChat();

  useEffect(() => {
    if (pendingRegistration) return undefined;
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return (): void => clearTimeout(timer);
  }, [onDismiss, pendingRegistration]);

  const summary = pendingRegistration
    ? "An admin still has to register this agent. Until that is done it can't be mentioned in a chat."
    : agent.description.trim() ||
      'Add tools, skills and knowledge here, or start a chat and put it to work.';

  return (
    <div
      role='status'
      className={cn(
        'isolate relative overflow-hidden rounded-[16px] border border-border px-5 py-4 bg-white/5 ~bg-gradient-to-r ~from-primary/25 ~via-primary/10 ~to-primary/30',
        'shadow-[0px_43px_26px_0px_rgba(0,0,0,0.01),0px_19px_19px_0px_rgba(0,0,0,0.02),0px_5px_10px_0px_rgba(0,0,0,0.02)]',
        'before:pointer-events-none before:-z-10 before:absolute before:-inset-x-[12%] before:h-[550%] before:bottom-full before:translate-y-[9%] before:bg-[radial-gradient(50%_50%_at_50%_50%,hsl(var(--primary))_54%,transparent)] before:blur-2xl',
      )}
    >
      <button
        type='button'
        aria-label='Dismiss'
        onClick={onDismiss}
        data-track-category='Claw Agents'
        data-track-name='Agent detail v2: dismiss created banner'
        className='absolute right-3 top-3 flex size-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
      >
        <MultipleCrossCancelDefault size={14} />
      </button>

      <div className='flex flex-col items-center gap-1.5 text-center'>
        <p className='font-serif text-[14px] font-semibold italic leading-[18px] text-foreground'>
          {agent.name} {pendingRegistration ? 'is waiting on an admin' : 'is ready'}
        </p>
        <p className='text-[13px] font-normal leading-[18px] text-foreground/80'>{summary}</p>
        <p className='text-[12px] leading-[16px] text-muted-foreground'>
          {pendingRegistration
            ? 'You can still chat with the agent from here.'
            : `Mention @${agent.slug} in any chat, or start one below.`}
        </p>

        {canOpenAgentChat && (
          <div className='mt-1 flex items-center gap-2'>
            <button
              type='button'
              onClick={() => openAgentChat(agent.slug)}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: chat with new agent'
              className='flex h-7 items-center rounded-[8px] border border-border bg-background px-2.5 text-[13px] font-semibold leading-[18px] text-foreground shadow-sm transition-colors hover:bg-accent'
            >
              Chat with agent
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
