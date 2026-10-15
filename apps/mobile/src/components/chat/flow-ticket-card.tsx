import { useRouter } from 'expo-router';
import { Calendar, NotebookText, TriangleAlert, User } from 'lucide-react-native';
import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { Button } from '@/src/components/ui/button';
import { useUser } from '@/src/hooks/useUsers';
import type { FlowActionButton } from '@/src/utils/flowAction';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';
import {
  createTicketCardViewModel,
  type TicketPriority,
  type TicketStatus,
} from '@/src/utils/flowTicketUtils';
import {
  buildWebTicketLinkFromIds,
  navigateToTicketDeepLinkIfApplicable,
  openTicketDeepLink,
} from '@/src/utils/ticketDeepLink';

const STATUS_DOT_CLASS: Record<TicketStatus, string> = {
  TODO: 'bg-ticket-status-todo',
  STARTED: 'bg-ticket-status-started',
  PAUSED: 'bg-ticket-status-paused',
  CANCELLED: 'bg-ticket-status-cancelled',
  COMPLETED: 'bg-ticket-status-completed',
};

const PRIORITY_VAR: Record<TicketPriority, string> = {
  LOW: '--color-ticket-priority-low',
  MEDIUM: '--color-ticket-priority-medium',
  HIGH: '--color-ticket-priority-high',
  CRITICAL: '--color-ticket-priority-critical',
};

const PRIORITY_BARS: Record<TicketPriority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 0,
};

const BAR_HEIGHTS = [6, 10, 14];

const PriorityGlyph = ({ priority }: { priority: TicketPriority }): ReactElement => {
  const color = useCSSVariable(PRIORITY_VAR[priority]) as string;
  if (priority === 'CRITICAL') {
    return <TriangleAlert size={14} color={color} strokeWidth={2} />;
  }
  const active = PRIORITY_BARS[priority];
  return (
    <View className='h-3.5 flex-row items-end gap-0.5'>
      {BAR_HEIGHTS.map((height, index) => (
        <View
          key={height}
          className='w-0.5 rounded-sm'
          style={{ height, backgroundColor: color, opacity: index < active ? 1 : 0.25 }}
        />
      ))}
    </View>
  );
};

const Assignee = ({ assigneeId }: { assigneeId: string | undefined }): ReactElement => {
  const muted = useCSSVariable('--color-muted-text') as string;
  const user = useUser(assigneeId ?? '');
  if (!assigneeId) {
    return (
      <View className='flex-row items-center gap-1.5'>
        <View className='h-5 w-5 items-center justify-center rounded-full border border-dashed border-border'>
          <User size={12} color={muted} strokeWidth={1.5} />
        </View>
        <Text className='text-sm text-muted-text'>Unassigned</Text>
      </View>
    );
  }
  return (
    <View className='min-w-0 shrink flex-row items-center gap-1.5'>
      <Avatar userIds={[assigneeId]} size={20} />
      <Text className='min-w-0 shrink text-sm text-foreground' numberOfLines={1}>
        {user?.name ?? 'Assignee'}
      </Text>
    </View>
  );
};

/**
 * Native renderer for the FlowJSON `ticket` artifact — both the approval card
 * an agent posts before `spaces-create-ticket` runs and the created-ticket card
 * that replaces it. Shared by chat v2 and v3.
 */
export const FlowTicketCard = memo(function FlowTicketCard({
  component,
  containerStyle,
  renderButton,
}: {
  component: FlowComponentLike;
  containerStyle?: StyleProp<ViewStyle>;
  renderButton: (button: FlowActionButton) => ReactElement;
}): ReactElement | null {
  const router = useRouter();
  const muted = useCSSVariable('--color-muted-text') as string;
  const viewModel = useMemo(() => createTicketCardViewModel(component), [component]);
  const link = viewModel?.link;

  const openTicket = useCallback((): void => {
    if (!link) return;
    const url = buildWebTicketLinkFromIds({ ...link, selectedTab: 'overview' });
    if (url && navigateToTicketDeepLinkIfApplicable(router, url)) return;
    openTicketDeepLink(router, { ...link, selectedTab: 'overview' });
  }, [link, router]);

  if (!viewModel) return null;
  const proposed = viewModel.phase === 'proposed';

  const card = (
    <View
      className={`w-full gap-3 rounded-xl border bg-chat-card px-3 py-3 ${
        proposed ? 'border-dashed border-border' : 'border-border'
      }`}
      style={{ alignSelf: 'stretch', minWidth: 0 }}
    >
      <View className='flex-row flex-wrap items-center justify-between gap-2'>
        <View className='min-w-0 shrink flex-row items-center gap-1.5'>
          <NotebookText size={16} color={muted} strokeWidth={1.75} />
          <Text
            className='min-w-0 shrink font-mono text-[13px] text-foreground/80'
            numberOfLines={1}
          >
            {viewModel.idLabel}
          </Text>
        </View>
        <View className='flex-row items-center gap-3'>
          <View className='flex-row items-center gap-1.5'>
            <View className={`h-2 w-2 rounded-full ${STATUS_DOT_CLASS[viewModel.status]}`} />
            <Text className='text-sm text-foreground'>{viewModel.statusLabel}</Text>
          </View>
          <View className='flex-row items-center gap-1.5'>
            <PriorityGlyph priority={viewModel.priority} />
            <Text className='text-sm text-foreground'>{viewModel.priorityLabel}</Text>
          </View>
        </View>
      </View>

      <Text className='text-[15px] font-medium leading-5 text-foreground'>{viewModel.title}</Text>

      <View className='flex-row flex-wrap items-center gap-x-4 gap-y-2'>
        <Assignee assigneeId={viewModel.assigneeId} />
        {viewModel.etaLabel ? (
          <View className='flex-row items-center gap-1.5'>
            <Calendar size={14} color={muted} strokeWidth={1.75} />
            <Text className='text-sm text-foreground'>{viewModel.etaLabel}</Text>
          </View>
        ) : null}
        {viewModel.stageName ? (
          <View className='rounded-full bg-ticket-label-blue-bg px-2 py-0.5'>
            <Text className='text-xs font-medium text-ticket-label-blue-text' numberOfLines={1}>
              {viewModel.stageName}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <View
      style={[{ alignSelf: 'stretch', width: '100%', minWidth: 0, gap: 10 }, containerStyle]}
      accessibilityLabel={`${proposed ? 'Ticket draft' : `Ticket ${viewModel.idLabel}`}: ${viewModel.title}`}
    >
      {link ? (
        <Pressable onPress={openTicket} accessibilityRole='button'>
          {card}
        </Pressable>
      ) : (
        card
      )}

      {proposed && viewModel.buttons.length > 0 ? (
        <View className='flex-row flex-wrap items-center justify-end gap-2'>
          {viewModel.buttons.map(button => renderButton(button))}
        </View>
      ) : null}

      {link ? (
        <View className='flex-row'>
          <Button
            size='xs'
            label='Open ticket'
            variant='secondary'
            onPressIn={event => event.stopPropagation()}
            onPress={event => {
              event.stopPropagation();
              openTicket();
            }}
          />
        </View>
      ) : null}
    </View>
  );
});
FlowTicketCard.displayName = 'FlowTicketCard';
