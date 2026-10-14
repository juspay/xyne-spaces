import { Ticket as TicketIcon, TriangleAlert } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

import Avatar from '@/src/components/ui/avatar';
import { useUser } from '@/src/hooks/useUsers';

import type { TicketPreview } from '../../model/chatRow.types';
import { useChatRenderTokens } from '../../theme/ChatRenderProvider';

const BAR_HEIGHTS = [6, 10, 14];

const priorityActiveBarCount = (priority: string | null | undefined): number => {
  switch (priority?.toUpperCase()) {
    case 'HIGH':
      return 3;
    case 'MEDIUM':
      return 2;
    case 'CRITICAL':
      return 0;
    default:
      return 1;
  }
};

const ticketIdLabel = (ticketId: string): string => ticketId.trim() || 'TICKET';

function PriorityIndicator({
  priority,
  activeColor,
}: {
  priority: string | null | undefined;
  activeColor: string;
}): ReactElement {
  if (priority?.toUpperCase() === 'CRITICAL') {
    return <TriangleAlert size={14} color={activeColor} strokeWidth={2} />;
  }

  const active = priorityActiveBarCount(priority);
  return (
    <View className='h-3.5 flex-row items-end gap-0.5'>
      {BAR_HEIGHTS.map((height, index) => (
        <View
          key={height}
          className='w-0.5 rounded-sm'
          style={{
            height,
            backgroundColor: activeColor,
            opacity: index < active ? 1 : 0.25,
          }}
        />
      ))}
    </View>
  );
}

export function TicketCard({
  ticket,
  mine,
}: {
  ticket: TicketPreview;
  mine: boolean;
}): ReactElement {
  const tokens = useChatRenderTokens();
  const assignee = useUser(ticket.assigneeId ?? '');
  const ownText = tokens.embeddedMutedUser;
  const priority = ticket.priority?.toUpperCase();
  const priorityColor =
    priority === 'CRITICAL'
      ? tokens.ticketPriorityCriticalColor
      : priority === 'HIGH'
        ? tokens.ticketPriorityHighColor
        : priority === 'MEDIUM'
          ? tokens.ticketPriorityMediumColor
          : tokens.ticketPriorityLowColor;

  return (
    <View
      className={`mb-2.5 flex w-full flex-col gap-2 self-stretch overflow-hidden rounded-lg px-1.5 py-2.5 ${
        mine ? '' : 'bg-conversation-composer-forwarded-bg-other'
      }`}
      style={mine ? { backgroundColor: tokens.embeddedBgUser } : undefined}
    >
      <View className='flex-row items-center justify-between gap-2'>
        <View
          className={`max-w-[50%] shrink flex-row items-center gap-1.5 rounded-full border px-2 py-1 ${
            mine
              ? 'border-foreground/20 bg-foreground/10'
              : 'border-ticket-priority-medium bg-ticket-priority-medium/15'
          }`}
        >
          <View
            className={`h-4 w-4 shrink-0 items-center justify-center rounded-full ${
              mine ? 'bg-foreground/10' : 'bg-ticket-priority-medium/20'
            }`}
          >
            <TicketIcon
              size={10}
              color={mine ? ownText : tokens.ticketPriorityMediumColor}
              strokeWidth={2.4}
            />
          </View>
          <Text
            className={`min-w-0 shrink text-xs font-semibold ${
              mine ? '' : 'text-ticket-priority-medium'
            }`}
            numberOfLines={1}
            style={mine ? { color: ownText } : undefined}
          >
            {ticketIdLabel(ticket.ticketId)}
          </Text>
        </View>

        <View className='min-w-0 shrink flex-row items-center justify-end gap-1.5'>
          <PriorityIndicator priority={ticket.priority} activeColor={priorityColor} />
          <View className='min-w-0 shrink flex-row items-center gap-1 rounded-full bg-ticket-label-blue-bg px-1.5 py-0.5'>
            <View className='h-1 w-1 shrink-0 rounded-full bg-ticket-label-blue-text' />
            <Text
              className='min-w-0 shrink text-xs font-medium text-ticket-label-blue-text'
              numberOfLines={1}
            >
              {ticket.statusLabel}
            </Text>
          </View>
        </View>
      </View>

      <View className='flex w-full flex-col gap-2'>
        <View className='flex w-full flex-col gap-1'>
          <Text
            className={`text-base font-medium leading-5 ${
              mine ? '' : 'text-ticket-overview-title-text'
            }`}
            numberOfLines={2}
            style={mine ? { color: tokens.embeddedTitleUser } : undefined}
          >
            {ticket.title}
          </Text>
          {ticket.description ? (
            <Text
              className={`text-sm font-medium leading-5 opacity-60 ${
                mine ? '' : 'text-ticket-overview-meta-text'
              }`}
              numberOfLines={1}
              style={mine ? { color: tokens.embeddedMutedUser } : undefined}
            >
              {ticket.description}
            </Text>
          ) : null}
        </View>

        {ticket.assigneeId ? (
          <>
            <View className='h-px w-full bg-ticket-overview-divider' />
            <View className='flex-row items-center gap-1.5'>
              <Avatar userIds={[ticket.assigneeId]} size={20} />
              <Text
                className='min-w-0 shrink text-sm font-medium leading-5 text-ticket-priority-critical'
                numberOfLines={1}
              >
                {assignee?.name ?? 'Assignee'}
              </Text>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}
