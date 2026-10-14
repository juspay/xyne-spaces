import { memo, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ticket as TicketIcon, TriangleAlert } from 'lucide-react-native';
import { parseTicketMd, TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';

import { useConversationComposer } from './conversation-composer-context';
import { DebugBoundary } from './utils/debug-boundary';
import Avatar from '@/src/components/ui/avatar';
import { useUser } from '@/src/hooks/useUsers';
import { cn } from '@/src/utils/cn';
import { getSenderAvatarFallbackUsers } from '@/src/features/chat/v2/paint/chatPaintAvatarFallback';
import type { AvatarFallbackUser } from '@/src/components/ui/avatar/avatar.types';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';
import { HTML_TAG_OR_EMPTY, stripHtmlTags } from '@/src/utils/htmlText';

function stripPlainTextFromHtml(html: string): string {
  return stripHtmlTags(html.replace(/<br\s*\/?>/gi, '\n'), HTML_TAG_OR_EMPTY)
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function labelForStatusV2(status: TicketStatusV2): string {
  const labels: Record<TicketStatusV2, string> = {
    [TicketStatusV2.TODO]: 'To do',
    [TicketStatusV2.STARTED]: 'In progress',
    [TicketStatusV2.PAUSED]: 'Paused',
    [TicketStatusV2.CANCELLED]: 'Cancelled',
    [TicketStatusV2.COMPLETED]: 'Completed',
  };
  return labels[status] ?? status;
}

function ticketStatusLabel(
  stageName: string | undefined,
  statusV2: TicketStatusV2 | undefined,
): string {
  if (stageName?.trim()) return stageName.trim();
  if (statusV2 !== undefined) return labelForStatusV2(statusV2);
  return '—';
}

function priorityIconVar(priority: TicketPriority): string {
  switch (priority) {
    case TicketPriority.LOW:
      return '--color-ticket-priority-low';
    case TicketPriority.MEDIUM:
      return '--color-ticket-priority-medium';
    case TicketPriority.HIGH:
      return '--color-ticket-priority-high';
    case TicketPriority.CRITICAL:
      return '--color-ticket-priority-critical';
  }
}

const PRIORITY_BAR_HEIGHTS = [6, 10, 14] as const;

function priorityActiveBars(priority: TicketPriority): number {
  switch (priority) {
    case TicketPriority.LOW:
      return 1;
    case TicketPriority.MEDIUM:
      return 2;
    case TicketPriority.HIGH:
      return 3;
    case TicketPriority.CRITICAL:
      return 0;
  }
}

function PriorityIndicator({
  priority,
  color,
}: {
  priority: TicketPriority;
  color: string;
}): ReactElement {
  if (priority === TicketPriority.CRITICAL) {
    return <TriangleAlert size={14} color={color} strokeWidth={2} />;
  }

  const activeBars = priorityActiveBars(priority);

  return (
    <View className='h-[14px] flex-row items-end gap-[2px]'>
      {PRIORITY_BAR_HEIGHTS.map((height, index) => (
        <View
          key={index}
          style={{
            backgroundColor: color,
            height,
            opacity: index < activeBars ? 1 : 0.25,
          }}
          className='w-[3px] rounded-[1.5px]'
        />
      ))}
    </View>
  );
}

type TicketProps = {
  className?: string;
};

const TicketAssigneeRow = ({
  userId,
  displayName,
  fallbackUsers = [],
}: {
  userId: string | null | undefined;
  displayName: string | null | undefined;
  fallbackUsers?: readonly AvatarFallbackUser[];
}): ReactElement | null => {
  if (!userId && !displayName) return null;
  return (
    <>
      <View className='h-[0.5px] w-full bg-ticket-overview-divider' />
      <View className='flex-row items-center gap-1.5'>
        <Avatar userIds={userId ? [userId] : []} fallbackUsers={fallbackUsers} size={20} />
        <Text
          className='min-w-0 shrink text-sm font-medium leading-5 tracking-[-0.16px] text-ticket-priority-critical'
          numberOfLines={1}
        >
          {displayName ?? 'Assignee'}
        </Text>
      </View>
    </>
  );
};

const TICKET_CARD_CLASS =
  'flex flex-col gap-2 w-full self-stretch rounded-[8px] px-1.5 py-2.5 overflow-hidden';

/**
 * Card container for the embedded ticket. Becomes pressable only when the host
 * supplies `onTicketPress` (e.g. the parent ticket row inside ticket details),
 * so the card is a smaller tap target than the surrounding message bubble. The
 * long-press handler is forwarded too, otherwise this nested Pressable would
 * swallow the bubble's long-press → message actions gesture.
 */
const TicketCardShell = ({
  className,
  style,
  onPress,
  onLongPress,
  children,
}: {
  className: string;
  style: StyleProp<ViewStyle>;
  onPress?: (() => void) | undefined;
  onLongPress?: (() => void) | undefined;
  children: ReactNode;
}): ReactElement => {
  if (!onPress) {
    return (
      <View className={className} style={style}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      className={className}
      style={({ pressed }) => [style, pressed ? { opacity: 0.7 } : null]}
      onPress={onPress}
      {...(onLongPress ? { onLongPress } : {})}
      delayLongPress={300}
    >
      {children}
    </Pressable>
  );
};

const Ticket = memo(({ className }: TicketProps): ReactElement | null => {
  const { item, kind, paintRow, onTicketPress, onTicketLongPress } = useConversationComposer();
  const { embeddedBgUser, embeddedMutedUser, embeddedTitleUser, rootAccentUser } =
    useChatRenderTokens();
  const ticketFromMd = parseTicketMd(item.ticket_md ?? null);
  const resolvedTicket = ticketFromMd ?? null;
  const assignee = useUser(resolvedTicket?.assignedTo ?? '');
  const ticketPriority = resolvedTicket?.priority ?? TicketPriority.LOW;
  const idIconColor = useCSSVariable('--color-ticket-overview-title-text') as string;
  const priorityIconColor = useCSSVariable(priorityIconVar(ticketPriority)) as string;
  const isCurrentUser = kind === 'CURRENT_USER';
  const cardBg = isCurrentUser
    ? 'bg-conversation-composer-forwarded-bg-user'
    : 'bg-conversation-composer-forwarded-bg-other';

  if (resolvedTicket) {
    const { title, description, assignedTo, statusV2, stageName, xyneId } = resolvedTicket;
    const assigneeName = assignee?.name ?? paintRow?.ticketPreview?.assignee?.displayName ?? null;
    const idLine = xyneId?.trim() || 'TICKET';
    const statusLine = ticketStatusLabel(stageName ?? undefined, statusV2 ?? undefined);
    const plainDescription = stripPlainTextFromHtml(description ?? '');
    const safeTitle = title?.trim() || plainDescription || 'Untitled ticket';

    return (
      <DebugBoundary>
        <TicketCardShell
          className={cn(TICKET_CARD_CLASS, isCurrentUser ? '' : cardBg, className)}
          style={isCurrentUser ? { backgroundColor: embeddedBgUser } : undefined}
          onPress={onTicketPress}
          onLongPress={onTicketLongPress}
        >
          <View className='flex-row items-center justify-between gap-2'>
            <View className='max-w-[46%] shrink flex-row items-center gap-1 rounded-[6px] bg-tertiary-bg p-1'>
              <TicketIcon
                size={12}
                color={isCurrentUser ? rootAccentUser : idIconColor}
                strokeWidth={2.2}
              />
              <Text
                className={cn(
                  'min-w-0 shrink text-[10px] font-medium',
                  isCurrentUser ? '' : 'text-ticket-overview-title-text',
                )}
                style={isCurrentUser ? { color: embeddedMutedUser } : undefined}
                numberOfLines={1}
              >
                {idLine}
              </Text>
            </View>

            <View className='min-w-0 shrink flex-row items-center justify-end gap-1.5'>
              <PriorityIndicator priority={ticketPriority} color={priorityIconColor} />

              <View className='min-w-0 shrink flex-row items-center gap-1 rounded-full bg-ticket-label-blue-bg px-1.5 py-0.5'>
                <View className='h-1 w-1 shrink-0 rounded-full bg-ticket-label-blue-text' />
                <Text
                  className='min-w-0 shrink text-[12px] font-medium text-ticket-label-blue-text'
                  numberOfLines={1}
                >
                  {statusLine}
                </Text>
              </View>
            </View>
          </View>

          <View className='flex flex-col gap-2 w-full'>
            <View className='flex flex-col gap-1 w-full'>
              <Text
                className={cn(
                  'text-base font-medium leading-5 tracking-[-0.16px]',
                  isCurrentUser ? '' : 'text-ticket-overview-title-text',
                )}
                style={isCurrentUser ? { color: embeddedTitleUser } : undefined}
                numberOfLines={2}
              >
                {safeTitle}
              </Text>
              {plainDescription ? (
                <Text
                  className={cn(
                    'text-[14px] font-medium leading-5 opacity-60',
                    isCurrentUser ? '' : 'text-ticket-overview-meta-text',
                  )}
                  style={isCurrentUser ? { color: embeddedMutedUser } : undefined}
                  numberOfLines={1}
                >
                  {plainDescription}
                </Text>
              ) : null}
            </View>

            <TicketAssigneeRow
              userId={assignedTo}
              displayName={assigneeName}
              fallbackUsers={getSenderAvatarFallbackUsers(paintRow?.ticketPreview?.assignee)}
            />
          </View>
        </TicketCardShell>
      </DebugBoundary>
    );
  }

  if (paintRow?.ticketPreview) {
    const ticket = paintRow.ticketPreview;
    const assigneeName = ticket.assignee?.displayName ?? null;
    const assigneeId = ticket.assignee?.senderId ?? null;
    const paintPriority =
      ticket.priority === 'CRITICAL'
        ? TicketPriority.CRITICAL
        : ticket.priority === 'HIGH'
          ? TicketPriority.HIGH
          : ticket.priority === 'MEDIUM'
            ? TicketPriority.MEDIUM
            : TicketPriority.LOW;
    return (
      <DebugBoundary>
        <TicketCardShell
          className={cn(TICKET_CARD_CLASS, isCurrentUser ? '' : cardBg, className)}
          style={isCurrentUser ? { backgroundColor: embeddedBgUser } : undefined}
          onPress={onTicketPress}
          onLongPress={onTicketLongPress}
        >
          <View className='flex-row items-center justify-between gap-2'>
            <View className='max-w-[46%] shrink flex-row items-center gap-1 rounded-[6px] bg-tertiary-bg p-1'>
              <TicketIcon
                size={12}
                color={isCurrentUser ? rootAccentUser : idIconColor}
                strokeWidth={2.2}
              />
              <Text
                className={cn(
                  'min-w-0 shrink text-[10px] font-medium',
                  isCurrentUser ? '' : 'text-ticket-overview-title-text',
                )}
                style={isCurrentUser ? { color: embeddedMutedUser } : undefined}
                numberOfLines={1}
              >
                {ticket.ticketId.trim() || 'TICKET'}
              </Text>
            </View>
            <View className='min-w-0 shrink flex-row items-center justify-end gap-1.5'>
              <PriorityIndicator priority={paintPriority} color={priorityIconColor} />
              <View className='min-w-0 shrink flex-row items-center gap-1 rounded-full bg-ticket-label-blue-bg px-1.5 py-0.5'>
                <View className='h-1 w-1 shrink-0 rounded-full bg-ticket-label-blue-text' />
                <Text
                  className='min-w-0 shrink text-[12px] font-medium text-ticket-label-blue-text'
                  numberOfLines={1}
                >
                  {ticket.statusLabel}
                </Text>
              </View>
            </View>
          </View>

          <View className='flex flex-col gap-2 w-full'>
            <View className='flex flex-col gap-1 w-full'>
              <Text
                className={cn(
                  'text-base font-medium leading-5 tracking-[-0.16px]',
                  isCurrentUser ? '' : 'text-ticket-overview-title-text',
                )}
                style={isCurrentUser ? { color: embeddedTitleUser } : undefined}
                numberOfLines={2}
              >
                {ticket.title}
              </Text>
              {ticket.description ? (
                <Text
                  className={cn(
                    'text-[14px] font-medium leading-5 opacity-60',
                    isCurrentUser ? '' : 'text-ticket-overview-meta-text',
                  )}
                  style={isCurrentUser ? { color: embeddedMutedUser } : undefined}
                  numberOfLines={1}
                >
                  {ticket.description}
                </Text>
              ) : null}
            </View>

            <TicketAssigneeRow
              userId={assigneeId}
              displayName={assigneeName}
              fallbackUsers={getSenderAvatarFallbackUsers(ticket.assignee)}
            />
          </View>
        </TicketCardShell>
      </DebugBoundary>
    );
  }

  return null;
});
Ticket.displayName = 'ConversationComposer.Ticket';

export { Ticket };
