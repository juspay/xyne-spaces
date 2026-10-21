import type { ReactElement } from 'react';
import { AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

import { cn } from '../../../utils/classNames';
import type { Message } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import { TurnTimeline } from '../../Chat/XyneAISidebar/components/TurnTimeline';
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
                  data-ph-capture-attribute-track-id='claw_retry_message'
                  data-track-category='CLAW_CHAT'
                  data-track-name='RETRY_MESSAGE'
                  className='self-start text-xs font-medium underline underline-offset-2 hover:opacity-80'
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        ) : isUser ? (
          <ClawMarkdown content={displayText} toolInvocations={message.toolInvocations} />
        ) : (
          <div className='flex flex-col gap-1'>
            {/* The turn in order — thinking, text, tool calls, … answer —
                shared with the AI screen and the sidebar. */}
            <TurnTimeline
              message={message}
              renderText={(text, { streaming }) => (
                <ClawMarkdown
                  content={streaming ? text + '\n' : text}
                  toolInvocations={message.toolInvocations}
                />
              )}
              legacyAnswer={
                rawText.trim() ? (
                  <ClawMarkdown content={displayText} toolInvocations={message.toolInvocations} />
                ) : null
              }
            />
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
          </div>
        )}
      </div>
    </motion.div>
  );
}
