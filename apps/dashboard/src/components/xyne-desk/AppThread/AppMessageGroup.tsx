import { ReactElement, useMemo } from 'react';
import { cn } from '../../../utils/classNames';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useUsers } from '../../../hooks/useUsers';
import UserAvatar, { AvatarSize } from '../../UserAvatar/UserAvatar';
import { UserHoverWrapper } from '../../ui/UserMentionPopover/UserMentionPopover';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import {
  MessageCardAttachmentThumbnails,
  type PanelAttachmentRow,
} from '../../Chat/MessageCard/MessageCardAttachmentThumbnails';

export type AppDeskMessage = {
  id: string;
  from: string | null;
  body: string | null;
  createdAt: number | null;
  type: string | null;
  sentByUserId?: string | null;
  attachments?: ReadonlyArray<{
    readonly id: string;
    readonly originalFilename?: string | null;
    readonly mimetype?: string | null;
    readonly thumbnailUrl?: string | null;
    readonly size?: number | null;
    [key: string]: unknown;
  }> | null;
  conversationId: string;
  channelId: string;
};

function displayNameFromHeader(from: string | null): string {
  if (!from) return 'Unknown';
  const named = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (named?.[1]?.trim()) return named[1].trim();
  return from.replace(/[<>]/g, '').trim() || 'Unknown';
}

function emailFromHeader(from: string | null): string | undefined {
  return from?.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? undefined;
}

const AVATAR_TINTS = [
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
] as const;

function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length]!;
}

const timeOf = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function groupTimeLabel(messages: AppDeskMessage[]): string {
  const stamps = messages.map(m => m.createdAt).filter((ms): ms is number => !!ms);
  if (stamps.length === 0) return '';
  const first = timeOf(stamps[0]!);
  const last = timeOf(stamps[stamps.length - 1]!);
  if (first === last) return last;
  const [firstClock, firstMeridiem] = first.split(' ');
  const lastMeridiem = last.split(' ')[1];
  return firstMeridiem && firstMeridiem === lastMeridiem
    ? `${firstClock} – ${last}`
    : `${first} – ${last}`;
}

function toPanelAttachments(message: AppDeskMessage): PanelAttachmentRow[] {
  return (message.attachments ?? []).map(a => ({
    id: a.id,
    mimetype: a.mimetype ?? 'application/octet-stream',
    originalFilename: a.originalFilename ?? 'file',
    thumbnailUrl: a.thumbnailUrl ?? null,
    size: a.size ?? 0,
  }));
}

const Bubble = ({
  message,
  outbound,
}: {
  message: AppDeskMessage;
  outbound: boolean;
}): ReactElement => {
  const attachments = useMemo(() => toPanelAttachments(message), [message]);
  return (
    <div
      className={cn(
        'w-fit max-w-[min(78%,42rem)] rounded-xl px-3.5 py-2 text-[15px] text-foreground [&_.jp-message-html]:leading-[1.45]',
        outbound ? 'bg-muted' : 'border border-border bg-card',
      )}
    >
      {message.body ? (
        <div className='jp-message-html [&_p]:m-0'>
          <RenderMessageWithHTML message={message.body} />
        </div>
      ) : (
        attachments.length === 0 && <span className='italic text-muted-foreground'>No content</span>
      )}
      {attachments.length > 0 && (
        <MessageCardAttachmentThumbnails
          attachments={attachments}
          className={message.body ? 'mt-2' : ''}
          trackCategory='app-desk'
        />
      )}
    </div>
  );
};

interface AppMessageGroupProps {
  messages: AppDeskMessage[];
  outbound: boolean;
}

export const AppMessageGroup = ({ messages, outbound }: AppMessageGroupProps): ReactElement => {
  const allUsers = useUsers();
  const head = messages[0]!;

  const senderEmail = useMemo(() => emailFromHeader(head.from), [head.from]);
  const resolvedUser = useMemo(() => {
    if (head.sentByUserId) return allUsers.find(u => u.id === head.sentByUserId);
    return senderEmail ? allUsers.find(u => u.email?.toLowerCase() === senderEmail) : undefined;
  }, [allUsers, head.sentByUserId, senderEmail]);

  const senderName = resolvedUser
    ? getUserDisplayName(resolvedUser)
    : displayNameFromHeader(head.from);
  const timeLabel = useMemo(() => groupTimeLabel(messages), [messages]);
  const isAutomation = outbound && !resolvedUser;

  const bubbles = (
    <div className={cn('flex w-full flex-col gap-2', outbound ? 'items-end' : 'items-start')}>
      {messages.map(message => (
        <Bubble key={message.id} message={message} outbound={outbound} />
      ))}
    </div>
  );

  if (outbound) {
    return (
      <div className='flex flex-col items-end gap-1.5'>
        <div className='flex items-center gap-2 pr-0.5'>
          {isAutomation && (
            <span className='font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground'>
              Automation
            </span>
          )}
          <span className='text-sm font-semibold text-foreground'>{senderName}</span>
          {resolvedUser && (
            <UserHoverWrapper userId={resolvedUser.id}>
              <UserAvatar userId={resolvedUser.id} size={AvatarSize.SM} showActiveStatus={false} />
            </UserHoverWrapper>
          )}
        </div>
        {bubbles}
        {timeLabel && (
          <span className='pr-0.5 font-mono text-[11px] tracking-[0.06em] text-muted-foreground'>
            {timeLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className='flex w-full gap-2.5'>
      {resolvedUser ? (
        <UserHoverWrapper userId={resolvedUser.id}>
          <UserAvatar userId={resolvedUser.id} size={AvatarSize.SM} showActiveStatus={false} />
        </UserHoverWrapper>
      ) : (
        <span
          className={cn(
            'mt-0.5 flex size-6 shrink-0 select-none items-center justify-center rounded-full text-[11px] font-semibold uppercase',
            tintFor(senderName),
          )}
          aria-hidden
        >
          {senderName.charAt(0)}
        </span>
      )}
      <div className='flex min-w-0 flex-1 flex-col items-start gap-1.5'>
        <span className='text-sm font-semibold text-foreground'>{senderName}</span>
        {bubbles}
        {timeLabel && (
          <span className='pl-0.5 font-mono text-[11px] tracking-[0.06em] text-muted-foreground'>
            {timeLabel}
          </span>
        )}
      </div>
    </div>
  );
};
