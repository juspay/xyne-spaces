import { ReactElement, useMemo } from 'react';
import { cn } from '../../../utils/classNames';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useUsers } from '../../../hooks/useUsers';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { AvatarSize } from '../../UserAvatar/UserAvatar';
import { UserHoverWrapper } from '../../ui/UserMentionPopover/UserMentionPopover';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { Button } from '../../ui/Button';
import {
  MessageCardAttachmentThumbnails,
  type PanelAttachmentRow,
} from '../../Chat/MessageCard/MessageCardAttachmentThumbnails';

export type SlackEmailMessage = {
  id: string;
  from: string | null;
  body: string | null;
  createdAt: number | null;
  type: string | null;
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

/** Extract email from "Name <email>" format */
function extractEmail(from: string | null): string | undefined {
  if (!from) return undefined;
  const match = from.match(/<([^>]+)>/);
  return match?.[1]?.toLowerCase();
}

const SlackMessage = ({ email }: { email: SlackEmailMessage }): ReactElement => {
  const allUsers = useUsers();

  const senderEmail = useMemo(() => extractEmail(email.from), [email.from]);
  const resolvedUser = useMemo(
    () => (senderEmail ? allUsers.find(u => u.email?.toLowerCase() === senderEmail) : undefined),
    [allUsers, senderEmail],
  );

  const senderName = resolvedUser ? getUserDisplayName(resolvedUser) : email.from || 'Unknown';

  const timestamp = email.createdAt
    ? new Date(email.createdAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  const isOutgoing = email.type === 'REPLY';

  const panelAttachments: PanelAttachmentRow[] = useMemo(
    () =>
      (email.attachments ?? []).map(a => ({
        id: a.id,
        mimetype: a.mimetype ?? 'application/octet-stream',
        originalFilename: a.originalFilename ?? 'file',
        thumbnailUrl: a.thumbnailUrl ?? null,
        size: a.size ?? 0,
      })),
    [email.attachments],
  );

  return (
    <div className={cn('flex gap-3 px-4 py-3', isOutgoing && 'bg-blue-50/40')}>
      {/* Avatar */}
      {resolvedUser ? (
        <UserHoverWrapper userId={resolvedUser.id}>
          <UserAvatar userId={resolvedUser.id} size={AvatarSize.REGULAR} showActiveStatus={false} />
        </UserHoverWrapper>
      ) : (
        <div className='size-8 shrink-0 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground uppercase select-none'>
          {senderName.charAt(0)}
        </div>
      )}
      <div className='flex-1 min-w-0'>
        {/* Sender + timestamp */}
        <div className='flex items-baseline gap-2'>
          {resolvedUser ? (
            <span className='flex items-center gap-1'>
              <UserHoverWrapper userId={resolvedUser.id}>
                <Button
                  variant='ghost'
                  className='text-sm font-medium text-foreground hover:underline p-0 h-auto min-w-0'
                >
                  <span className='flex items-center gap-1'>{senderName}</span>
                </Button>
              </UserHoverWrapper>
              <StatusIndicator
                statusEmoji={resolvedUser.statusEmoji}
                statusContent={resolvedUser.statusContent}
                statusExpiryAt={resolvedUser.statusExpiryAt}
                size='sm'
                showOnHover={true}
              />
            </span>
          ) : (
            <span className='text-sm font-semibold text-foreground truncate'>{senderName}</span>
          )}
          <span className='text-[11px] text-muted-foreground whitespace-nowrap'>{timestamp}</span>
        </div>
        {/* Body */}
        <div className='mt-1 text-sm text-foreground leading-relaxed'>
          {email.body ? (
            <div className='jp-message-html inline-block'>
              <RenderMessageWithHTML message={email.body} />
            </div>
          ) : (
            !panelAttachments.length && (
              <span className='text-muted-foreground italic'>No content</span>
            )
          )}
        </div>
        {/* Attachments — same rendering as chat (image/video previews + gallery) */}
        {panelAttachments.length > 0 && (
          <MessageCardAttachmentThumbnails
            attachments={panelAttachments}
            className='mt-2'
            trackCategory='slack-desk'
          />
        )}
      </div>
    </div>
  );
};

export default SlackMessage;
