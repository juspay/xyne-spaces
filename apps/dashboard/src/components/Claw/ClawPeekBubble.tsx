import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PILL } from './claw.constants';
import { useClawConversation, useClawTabStatus } from './ClawConversationContext';

interface ClawPeekBubbleProps {
  isOpen: boolean;
}

const PEEK_DURATION_MS = 5000;
const PREVIEW_MAX = 160;

export function ClawPeekBubble({ isOpen }: ClawPeekBubbleProps): ReactElement {
  const { messages } = useClawConversation();
  const { hasUnseenAnswer, hasError } = useClawTabStatus();

  const lastBotMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find(m => m.type === 'bot' && !m.isStreaming && !m.errorInfo && !!m.content?.trim()),
    [messages],
  );
  const lastBotId = lastBotMessage?.id ?? null;

  const [visibleId, setVisibleId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen || !hasUnseenAnswer || !lastBotId || hasError) {
      setVisibleId(null);
      return;
    }
    setVisibleId(lastBotId);
    const timer = setTimeout(() => setVisibleId(null), PEEK_DURATION_MS);
    return (): void => clearTimeout(timer);
  }, [isOpen, hasUnseenAnswer, lastBotId, hasError]);

  const show = !isOpen && visibleId !== null;
  const preview = lastBotMessage?.content?.trim() ?? '';
  const text = preview.length > PREVIEW_MAX ? `${preview.slice(0, PREVIEW_MAX)}…` : preview;

  return (
    <div
      data-slot='claw-peek-bubble'
      className='pointer-events-none absolute right-0 flex max-w-[300px] justify-end'
      style={{ bottom: PILL.height + 12 }}
    >
      <AnimatePresence>
        {show && (
          <motion.div
            key={visibleId}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
            className='relative'
          >
            <div className='rounded-2xl rounded-br-sm border border-border bg-popover/95 px-3 py-2 text-popover-foreground shadow-lg'>
              <p className='line-clamp-3 whitespace-pre-wrap break-words text-sm leading-snug'>
                {text}
              </p>
            </div>
            <div className='absolute -bottom-1 right-14 size-2.5 rotate-45 rounded-[2px] border-b border-r border-border bg-popover/95' />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
