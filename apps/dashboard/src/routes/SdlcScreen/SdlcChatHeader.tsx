import type { ReactElement } from 'react';
import { MessageCircle, MessagesSquare, Sparkles, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { SdlcChatTab } from './sdlcChatPolicy';

interface SdlcChatHeaderProps {
  activeTab: SdlcChatTab;
  canOpenConversations?: boolean;
  onOpenConversations: () => void;
  onOpenAI: () => void;
  onClose: () => void;
}

export function SdlcChatHeader({
  activeTab,
  canOpenConversations = true,
  onOpenConversations,
  onOpenAI,
  onClose,
}: SdlcChatHeaderProps): ReactElement {
  const tabClass = (active: boolean): string =>
    active
      ? 'flex items-center gap-1 rounded-md bg-background px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm'
      : 'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className='flex h-12 shrink-0 items-center gap-2 bg-transparent px-3'>
      <MessageCircle className='size-4 shrink-0 text-primary' />
      <div className='min-w-0 flex-1 text-sm font-semibold text-primary'>Chat</div>
      <div className='flex shrink-0 items-center rounded-lg border bg-muted/30 p-0.5'>
        <button
          type='button'
          disabled={!canOpenConversations}
          onClick={onOpenConversations}
          className={tabClass(activeTab === 'conversations')}
          aria-current={activeTab === 'conversations' ? 'page' : undefined}
          data-track-category='SdlcHub'
          data-track-name='SdlcChatTabSwitched'
          data-track-metadata={JSON.stringify({ tab: 'conversations' })}
        >
          <MessagesSquare className='size-3.5' />
          Conversations
        </button>
        <button
          type='button'
          onClick={onOpenAI}
          className={tabClass(activeTab === 'ai')}
          aria-current={activeTab === 'ai' ? 'page' : undefined}
          data-track-category='SdlcHub'
          data-track-name='SdlcChatTabSwitched'
          data-track-metadata={JSON.stringify({ tab: 'ai' })}
        >
          <Sparkles className='size-3.5' />
          Assistant
        </button>
      </div>
      <Button variant='ghost' size='iconSm' onClick={onClose} aria-label='Close Chat'>
        <X />
      </Button>
    </div>
  );
}
