import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { Room } from 'livekit-client';
import { X, Send, User } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';
import { useCallChat } from '../hooks/useCallChat';
import type { ChatMessage } from '../hooks/useCallChat';

interface CallChatPanelProps {
  room: Room | null;
  externalId: string | null;
  localParticipantId: string | null;
  onClose: () => void;
  onNewMessage?: (() => void) | undefined;
  isExternalUser?: boolean | undefined;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// Deterministic color from name
const AVATAR_COLORS = [
  'bg-blue-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
  'bg-indigo-600',
  'bg-teal-600',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

/** Whether to show avatar + name header for this message (group consecutive same-sender messages) */
function shouldShowHeader(messages: ChatMessage[], index: number): boolean {
  if (index === 0) return true;
  const prev = messages[index - 1]!;
  const curr = messages[index]!;
  if (prev.participantId !== curr.participantId) return true;
  // Show header if > 5 min gap
  const gap = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime();
  return gap > 5 * 60 * 1000;
}

function MessageItem({ msg, showHeader }: { msg: ChatMessage; showHeader: boolean }) {
  const avatarColor = useMemo(() => getAvatarColor(msg.displayName), [msg.displayName]);

  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 px-4 py-0.5 hover:bg-accent/50',
        showHeader && 'mt-3 first:mt-0',
      )}
    >
      {/* Left: Avatar or time gutter */}
      <div className='w-8 flex-shrink-0 flex items-start justify-center pt-0.5'>
        {showHeader ? (
          <div
            className={cn(
              'w-8 h-8 rounded-md flex items-center justify-center text-white text-xs font-semibold',
              avatarColor,
            )}
          >
            {getInitials(msg.displayName) || <User size={14} />}
          </div>
        ) : (
          <span className='text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 pt-1'>
            {formatTime(msg.createdAt)}
          </span>
        )}
      </div>

      {/* Right: Name + content */}
      <div className='flex-1 min-w-0'>
        {showHeader && (
          <div className='flex items-center gap-2 min-h-5'>
            <span className='text-sm font-medium text-foreground'>
              {msg.isLocal ? 'You' : msg.displayName}
            </span>
            {msg.isExternal && (
              <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700 shrink-0'>
                External
              </span>
            )}
            <span className='text-[10px] text-muted-foreground'>{formatTime(msg.createdAt)}</span>
          </div>
        )}
        <div className='text-sm text-foreground prose prose-sm dark:prose-invert max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-0.5 [&_pre]:my-1 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-3 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground'>
          <Markdown remarkPlugins={[remarkGfm]}>{msg.message}</Markdown>
        </div>
      </div>
    </div>
  );
}

export function CallChatPanel({
  room,
  externalId,
  localParticipantId,
  onClose,
  onNewMessage,
  isExternalUser = false,
}: CallChatPanelProps) {
  const { messages, sendMessage, isLoading } = useCallChat(
    room,
    externalId,
    localParticipantId,
    isExternalUser,
  );
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevMessageCountRef = useRef(messages.length);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Notify parent of new remote messages (for unread badge)
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      const newest = messages[messages.length - 1];
      if (newest && !newest.isLocal) {
        onNewMessage?.();
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages, onNewMessage]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isSending) return;
    setIsSending(true);
    try {
      await sendMessage(input);
      setInput('');
    } finally {
      setIsSending(false);
      // Defer focus so React re-renders the textarea as enabled first
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.style.height = 'auto';
          inputRef.current.focus();
        }
      });
    }
  }, [input, isSending, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className='flex flex-col h-full'>
      {/* Header */}
      <div className='flex items-center justify-between px-4 py-3 border-b border-border min-h-[52px]'>
        <h3 className='text-sm font-semibold text-foreground'>External Chat</h3>
        <button
          onClick={onClose}
          className='p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
          data-track-category='CALLS'
          data-track-name='CLOSE_CALL_CHAT'
        >
          <X size={18} />
        </button>
      </div>
      <div className='px-4 py-2 bg-muted/50 border-b border-border'>
        <p className='text-xs text-muted-foreground'>
          {isExternalUser
            ? 'Messages sent here are visible to everyone in the call.'
            : 'Use this chat to interact with external participants. Only messages sent here will be visible to them.'}
        </p>
      </div>

      {/* Messages */}
      <div className='flex-1 overflow-y-auto py-2'>
        {isLoading && (
          <div className='flex items-center justify-center py-8'>
            <div className='w-5 h-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin' />
          </div>
        )}
        {!isLoading && messages.length === 0 && (
          <div className='flex-1 flex items-center justify-center h-full'>
            <p className='text-sm text-muted-foreground'>
              No messages yet. Start the conversation!
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageItem key={msg.id} msg={msg} showHeader={shouldShowHeader(messages, i)} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className='px-4 py-3 border-t border-border'>
        <div className='flex items-end gap-2'>
          <textarea
            data-track-category='CALLS'
            data-track-name='CALL_CHAT_INPUT'
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Type a message...'
            rows={1}
            className='flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none max-h-32 overflow-y-auto'
            style={{ minHeight: '38px' }}
            disabled={isSending}
            onInput={e => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
            }}
          />
          <Button
            variant='ghost'
            onClick={() => void handleSend()}
            disabled={!input.trim() || isSending}
            trackId='send_call_chat_message'
            data-track-category='CALLS'
            data-track-name='SEND_CALL_CHAT_MESSAGE'
            className={cn(
              'p-2 rounded-lg transition-colors flex-shrink-0',
              input.trim() && !isSending
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            <Send size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}
