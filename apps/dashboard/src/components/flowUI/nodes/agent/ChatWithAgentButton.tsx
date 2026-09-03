import React from 'react';
import { MessageSquare } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { useOpenAgentChat } from '../../../../hooks/useOpenAgentChat';

export const ChatWithAgentButton: React.FC<{
  slug: string;
  label?: string;
  className?: string;
}> = ({ slug, label = 'Chat with agent', className }) => {
  const { canOpenAgentChat, openAgentChat } = useOpenAgentChat();

  if (!canOpenAgentChat) {
    return null;
  }

  return (
    <button
      type='button'
      onClick={(event): void => {
        event.stopPropagation();
        openAgentChat(slug);
      }}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5',
        'text-sm font-medium leading-5 text-foreground hover:bg-foreground/[0.04]',
        className,
      )}
      data-track-category='AGENT_ARTIFACT'
      data-track-name='CLICK_CHAT_WITH_AGENT'
    >
      <MessageSquare size={14} className='shrink-0' aria-hidden />
      {label}
    </button>
  );
};
