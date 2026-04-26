import { useState, useEffect, useRef, useMemo } from 'react';
import { Loader2, User, MessageSquare } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../../utils/classNames';
import { callChatService } from '../../../services/Call/callChatService';
import type { CallChatMessage } from '@xyne/shared';

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

function shouldShowHeader(messages: CallChatMessage[], index: number): boolean {
  if (index === 0) return true;
  const prev = messages[index - 1]!;
  const curr = messages[index]!;
  if (prev.participantId !== curr.participantId) return true;
  const gap = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime();
  return gap > 5 * 60 * 1000;
}

function MessageItem({ msg, showHeader }: { msg: CallChatMessage; showHeader: boolean }) {
  const avatarColor = useMemo(() => getAvatarColor(msg.displayName), [msg.displayName]);

  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 px-4 py-0.5 hover:bg-accent/50',
        showHeader && 'mt-3 first:mt-0',
      )}
    >
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

      <div className='flex-1 min-w-0'>
        {showHeader && (
          <div className='flex items-center gap-2 min-h-5'>
            <span className='text-sm font-medium text-foreground'>{msg.displayName}</span>
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

interface UseExternalChatMessagesOptions {
  callExternalId: string;
  enabled?: boolean;
}

export function useExternalChatMessages({
  callExternalId,
  enabled = true,
}: UseExternalChatMessagesOptions) {
  const [messages, setMessages] = useState<CallChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !callExternalId) return;
    if (fetchedRef.current === callExternalId) return;

    fetchedRef.current = callExternalId;
    setLoading(true);
    setError(null);

    void callChatService
      .getChatHistory(callExternalId)
      .then(data => {
        setMessages(data.messages);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load chat history';
        setError(message);
        setLoading(false);
      });
  }, [enabled, callExternalId]);

  const reset = () => {
    fetchedRef.current = null;
    setMessages([]);
    setError(null);
  };

  return { messages, loading, error, reset };
}

interface ExternalChatMessagesProps {
  messages: CallChatMessage[];
  loading: boolean;
  error: string | null;
}

export function ExternalChatMessages({ messages, loading, error }: ExternalChatMessagesProps) {
  return (
    <>
      {loading && (
        <div className='flex items-center justify-center py-8'>
          <Loader2 className='w-5 h-5 animate-spin text-muted-foreground' />
        </div>
      )}
      {error && (
        <div className='flex items-center justify-center py-8'>
          <p className='text-sm text-destructive'>{error}</p>
        </div>
      )}
      {!loading && !error && messages.length === 0 && (
        <div className='flex flex-col items-center justify-center py-8 gap-2'>
          <MessageSquare className='w-8 h-8 text-muted-foreground/50' />
          <p className='text-sm text-muted-foreground'>No external chat messages</p>
        </div>
      )}
      {!loading &&
        !error &&
        messages.map((msg, i) => (
          <MessageItem key={msg.id} msg={msg} showHeader={shouldShowHeader(messages, i)} />
        ))}
    </>
  );
}
