import React, { useCallback, useMemo } from 'react';
import { ReplyAll, CornerUpLeft, ChevronDown, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { cn } from '../../../utils/classNames';
import { parseFromField } from './helpers';
import { extractEmail, computePreviewRecipients } from './recipients';

type ReplyMode = 'reply' | 'replyAll';

interface Email {
  id: string;
  from?: string | null;
  to?: ReadonlyArray<string> | null;
  cc?: ReadonlyArray<string> | null;
  createdAt?: number | null;
}

interface ReplyPillProps {
  emails: ReadonlyArray<Email>;
  deskEmail?: string | null | undefined;
  replyMode: ReplyMode;
  setReplyMode: (mode: ReplyMode) => void;
  onOpen: (mode: ReplyMode) => void;
  className?: string;
}

export const ReplyPill: React.FC<ReplyPillProps> = ({
  emails,
  deskEmail,
  replyMode,
  setReplyMode,
  onOpen,
  className,
}) => {
  const selfAddresses = useMemo(
    () => [deskEmail].filter((s): s is string => !!s && s.length > 0),
    [deskEmail],
  );

  const recipients = useMemo(
    () => computePreviewRecipients(emails, replyMode, selfAddresses),
    [emails, replyMode, selfAddresses],
  );

  const visibleCount = 2;
  const visible = recipients.slice(0, visibleCount);
  const remaining = Math.max(0, recipients.length - visibleCount);

  const label = replyMode === 'replyAll' ? 'Reply all' : 'Reply';

  const handleOpen = useCallback((): void => onOpen(replyMode), [onOpen, replyMode]);

  const selectMode = useCallback(
    (mode: ReplyMode): void => {
      setReplyMode(mode);
      onOpen(mode);
    },
    [setReplyMode, onOpen],
  );

  const handleStopPropagation = useCallback((event: React.SyntheticEvent): void => {
    event.stopPropagation();
  }, []);

  const handlePillKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleOpen();
      }
    },
    [handleOpen],
  );

  const handleSelectReply = useCallback(
    (event: Event): void => {
      event.preventDefault();
      selectMode('reply');
    },
    [selectMode],
  );

  const handleSelectReplyAll = useCallback(
    (event: Event): void => {
      event.preventDefault();
      selectMode('replyAll');
    },
    [selectMode],
  );

  return (
    <motion.div
      initial={false}
      transition={{ duration: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        'group bg-card text-card-foreground',
        'flex items-center justify-between overflow-hidden cursor-text select-none',
        'rounded-full p-1 border border-border',
        'shadow-md hover:shadow-lg',
        'transition-shadow duration-200',
        className,
      )}
      onClick={handleOpen}
      role='button'
      tabIndex={0}
      onKeyDown={handlePillKeyDown}
      data-slot='reply-pill'
      data-track-category='Support'
      data-track-name='OpenReplyPill'
    >
      <div className='flex items-center pl-0.5 pr-2.5 py-1.5 min-w-0 flex-1'>
        <div className='flex items-center min-w-0 flex-1'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                onClick={handleStopPropagation}
                onKeyDown={handleStopPropagation}
                className={cn(
                  'flex items-center gap-2 p-1.5 rounded-lg shrink-0',
                  'hover:bg-accent hover:text-accent-foreground active:bg-accent/80',
                  'transition-colors cursor-pointer',
                )}
                aria-label={`Switch reply mode. Current: ${label}`}
                data-track-category='Support'
                data-track-name='ReplyPillModeDropdown'
              >
                <div className='flex items-center gap-1'>
                  {replyMode === 'replyAll' ? (
                    <ReplyAll size={16} className='text-foreground' />
                  ) : (
                    <CornerUpLeft size={16} className='text-foreground' />
                  )}
                  <span className='font-medium text-[13px] leading-[18px] text-foreground whitespace-nowrap'>
                    {label}
                  </span>
                </div>
                <ChevronDown size={14} className='text-foreground shrink-0' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              side='top'
              sideOffset={8}
              className='min-w-[160px]'
              onClick={handleStopPropagation}
            >
              <DropdownMenuItem
                onSelect={handleSelectReply}
                className='flex items-center gap-2 cursor-pointer'
              >
                <CornerUpLeft size={14} className='text-muted-foreground' />
                <span className='flex-1'>Reply</span>
                {replyMode === 'reply' && <Check size={14} className='text-foreground' />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleSelectReplyAll}
                className='flex items-center gap-2 cursor-pointer'
              >
                <ReplyAll size={14} className='text-muted-foreground' />
                <span className='flex-1'>Reply all</span>
                {replyMode === 'replyAll' && <Check size={14} className='text-foreground' />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {recipients.length > 0 && (
            <div className='flex items-center gap-1 min-w-0 overflow-hidden'>
              {visible.map(raw => {
                const parsed = parseFromField(raw);
                const emailOnly = parsed.email ?? extractEmail(raw);
                return (
                  <span
                    key={raw}
                    className='font-normal text-[13px] leading-[18px] text-muted-foreground whitespace-nowrap'
                    title={parsed.name ? `${parsed.name} <${emailOnly}>` : emailOnly}
                  >
                    {`<${emailOnly}>`}
                  </span>
                );
              })}
              {remaining > 0 && (
                <span
                  className={cn(
                    'inline-flex items-center justify-center shrink-0',
                    'bg-muted border border-border',
                    'rounded px-1.5 py-0.5',
                    'font-normal text-[13px] leading-[18px] text-muted-foreground whitespace-nowrap',
                  )}
                >
                  {remaining} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default ReplyPill;
