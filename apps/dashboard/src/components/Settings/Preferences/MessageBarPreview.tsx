import type { ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MoreVertical, SmilePlus } from 'lucide-react';
import { messageActionsStore } from '../../../hooks/barItems';
import { useInlineQuickReactions } from '../../../hooks/useFrequentEmojis';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import { MESSAGE_BAR_ICONS } from '../../Chat/HoverActionsToolbar/messageBarActions';
import { isMessageBarActionId } from '../../../utils/messageBar';
import { BAR_PREVIEW_ICON_SLOT_CLASS, BAR_PREVIEW_SLOT_CLASS } from '../../../constants/messageBar';

export const MessageBarPreview = (): ReactElement => {
  const ids = messageActionsStore.useItems().filter(isMessageBarActionId);
  const emojis = useInlineQuickReactions();
  const reduceMotion = useReducedMotion() ?? false;
  const transition = reduceMotion
    ? { duration: 0 }
    : ({ type: 'spring', duration: 0.3, bounce: 0 } as const);

  return (
    <div
      aria-hidden
      className='relative rounded-xl border border-border bg-muted/30 px-3 pb-3 pt-8'
    >
      <div className='flex gap-3 rounded-lg bg-accent/60 px-3 pb-3 pt-4'>
        <div className='size-8 shrink-0 rounded-md bg-foreground/10' />
        <div className='min-w-0 flex-1 space-y-2 pt-0.5'>
          <div className='flex items-center gap-2'>
            <div className='h-2.5 w-20 rounded-full bg-foreground/20' />
            <div className='h-2 w-8 rounded-full bg-foreground/10' />
          </div>
          <div className='h-2 w-11/12 rounded-full bg-foreground/10' />
          <div className='h-2 w-3/5 rounded-full bg-foreground/10' />
        </div>
      </div>
      <motion.div
        layout
        transition={transition}
        style={{ borderRadius: 8 }}
        className='absolute right-6 top-3.5 flex items-center gap-1 border border-border bg-popover p-1 shadow-md'
      >
        <motion.div layout transition={transition} className='flex items-center gap-1'>
          {emojis.length > 0 && (
            <div className='flex items-center gap-0.5'>
              {emojis.map(emoji => (
                <span key={emoji} className={BAR_PREVIEW_SLOT_CLASS}>
                  {renderEmoji(emoji, 'w-4 h-4', 'text-base')}
                </span>
              ))}
            </div>
          )}
          <span className={BAR_PREVIEW_ICON_SLOT_CLASS}>
            <SmilePlus className='w-4 h-4' />
          </span>
        </motion.div>
        <AnimatePresence initial={false} mode='popLayout'>
          {ids.map(id => (
            <motion.span
              key={id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={transition}
              className={BAR_PREVIEW_ICON_SLOT_CLASS}
            >
              {MESSAGE_BAR_ICONS[id]}
            </motion.span>
          ))}
        </AnimatePresence>
        <motion.span layout transition={transition} className={BAR_PREVIEW_ICON_SLOT_CLASS}>
          <MoreVertical className='w-4 h-4' />
        </motion.span>
      </motion.div>
    </div>
  );
};
