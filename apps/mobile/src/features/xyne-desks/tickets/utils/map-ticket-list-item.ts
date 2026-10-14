import type { TicketListItemData } from '../types';

export type MapTicketListItemInput = {
  id: string;
  xyneId?: string | null;
  title?: string | null;
  stageName?: string | null;
  emailCount?: number | null;
  lastEmailAt?: number | null;
  isUnread?: boolean;
  isStarred?: boolean;
  senderName?: string | null;
  snippet?: string | null;
};

export function mapTicketListItem(input: MapTicketListItemInput): TicketListItemData {
  const xyneId = (input.xyneId ?? '').trim() || input.id;
  const title = (input.title ?? '').trim() || '(No subject)';
  const stageName = input.stageName ?? null;
  const emailCount = input.emailCount ?? 0;

  const senderName = (input.senderName ?? '').trim() || xyneId;
  const snippet =
    (input.snippet ?? '').trim() ||
    [stageName, emailCount > 0 ? `${emailCount} email${emailCount === 1 ? '' : 's'}` : null]
      .filter(Boolean)
      .join(' · ') ||
    'No preview';

  return {
    id: input.id,
    xyneId,
    title,
    stageName,
    emailCount,
    lastEmailAt: input.lastEmailAt ?? 0,
    isUnread: input.isUnread ?? false,
    isStarred: input.isStarred === true,
    senderName,
    snippet,
  };
}
