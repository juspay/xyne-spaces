import type { ReactElement } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../../utils/classNames';
import type { Message } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import { ActivityBlock } from '../../Chat/XyneAISidebar/components/ActivityBlock';
import { PendingActionBlock } from '../../Chat/XyneAISidebar/components/PendingActionBlock';
import { respondToPendingAction } from '../../../services/XyneAI/XyneAIPendingActionService';
import { useClawConversation } from '../ClawConversationContext';
import { ClawMarkdown } from './ClawMarkdown';

interface MessageBubbleProps {
  message: Message;
  onRetry?: (() => void) | undefined;
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps): ReactElement {
  const { resolvePendingAction, selectedAgentSlug } = useClawConversation();
  const isUser = message.type === 'user';
  const rawText = message.isStreaming ? (message.streamingContent ?? '') : (message.content ?? '');

  const displayText = message.isStreaming ? rawText + '\n' : rawText;
  const showThinking = message.isStreaming && rawText.trim().length === 0;
  const showActivity =
    !isUser &&
    (message.isStreaming || !!message.reasoning?.length || !!message.toolInvocations?.length);

  return (
    <motion.div
      data-slot='claw-message'
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : message.errorInfo
              ? 'bg-destructive/10 border border-destructive/30 text-destructive'
              : 'bg-muted text-foreground border border-border/60',
        )}
      >
        {message.errorInfo ? (
          <div className='flex items-start gap-2'>
            <AlertCircle className='size-4 shrink-0 mt-0.5' />
            <div className='flex flex-col gap-1'>
              <span className='font-medium'>{message.errorInfo.title}</span>
              <span className='text-destructive/90'>{message.errorInfo.message}</span>
              {onRetry && message.errorInfo.retryable !== false && (
                <button
                  type='button'
                  onClick={onRetry}
                  data-track-category='CLAW_CHAT'
                  data-track-name='RETRY_MESSAGE'
                  className='self-start text-xs font-medium underline underline-offset-2 hover:opacity-80'
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        ) : showThinking ? (
          <div className='flex items-center gap-2 text-muted-foreground'>
            <Loader2 className='size-3.5 animate-spin' />
            <span>
              {typeof message.statusMessage === 'string' ? message.statusMessage : 'Thinking'}
            </span>
          </div>
        ) : (
          <div className='flex flex-col gap-1'>
            {showActivity && (
              <ActivityBlock
                reasoning={message.reasoning}
                toolInvocations={message.toolInvocations}
                streaming={message.isStreaming}
                messageAborted={!!message.isAborted}
              />
            )}
            {message.pendingActions && message.pendingActions.length > 0 && (
              <PendingActionBlock
                actions={message.pendingActions}
                onApprove={async (action, index) => {
                  await respondToPendingAction(
                    message,
                    action,
                    index,
                    true,
                    selectedAgentSlug ?? 'ask-ai',
                  );
                  resolvePendingAction(message.id, index, 'approved');
                }}
                onDecline={async (action, index) => {
                  await respondToPendingAction(
                    message,
                    action,
                    index,
                    false,
                    selectedAgentSlug ?? 'ask-ai',
                  );
                  resolvePendingAction(message.id, index, 'declined');
                }}
              />
            )}
            <div className={cn(showActivity && 'pl-[22px]')}>
              <ClawMarkdown content={displayText} toolInvocations={message.toolInvocations} />
            </div>
            {message.isStreaming && rawText.trim().length > 0 && (
              <span className='inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle' />
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
