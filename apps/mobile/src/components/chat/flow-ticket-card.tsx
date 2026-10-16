import { useRouter } from 'expo-router';
import { Calendar, NotebookText, TriangleAlert, User } from 'lucide-react-native';
import { memo, useCallback, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { FlowAction } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { TicketCard } from '@/src/features/chat/v3/rows/parts/TicketCard';
import { useRecyclingState } from '@/src/features/chat/v3/rows/useRecyclingState';
import { useUser } from '@/src/hooks/useUsers';
import type { FlowActionButton } from '@/src/utils/flowAction';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';
import {
  createTicketCardViewModel,
  toTicketPreview,
  type TicketCardViewModel,
  type TicketPriority,
  type TicketStatus,
} from '@/src/utils/flowTicketUtils';
import {
  buildWebTicketLinkFromIds,
  navigateToTicketDeepLinkIfApplicable,
  openTicketDeepLink,
} from '@/src/utils/ticketDeepLink';

const ACCENT = '#EB5F3A';

/** The slice of a flow renderer's action state the card needs (v2 and v3 both provide it). */
export type TicketCardActions = {
  canPressButtons: boolean;
  isSubmitting: boolean;
  executeAction: (action: FlowAction) => Promise<unknown>;
};
const BUTTON_HEIGHT = 36;

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
 * Fixed-size action button: equal-width slot in the row, centred label, and the
 * spinner is overlaid on the label instead of pushing it, so tapping never
 * reflows the row.
 */
const TicketActionButton = ({
  button,
  loading,
  disabled,
  onPress,
}: {
  button: FlowActionButton;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}): ReactElement => {
  const foreground = useCSSVariable('--color-foreground') as string;
  const primary = button.variant === 'primary';
  const textColor = primary ? '#ffffff' : foreground;
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={button.label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      hitSlop={4}
      onPressIn={event => event.stopPropagation()}
      onPress={event => {
        event.stopPropagation();
        onPress();
      }}
      className={`items-center justify-center rounded-lg px-2 ${
        primary ? '' : 'border border-border'
      }`}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 0,
        height: BUTTON_HEIGHT,
        backgroundColor: primary ? ACCENT : 'transparent',
        opacity: disabled && !loading ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{
          color: textColor,
          fontSize: 14,
          fontWeight: '600',
          textAlign: 'center',
          opacity: loading ? 0 : 1,
        }}
      >
        {button.label}
      </Text>
      {loading ? (
        <View
          pointerEvents='none'
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator size='small' color={textColor} />
        </View>
      ) : null}
    </Pressable>
  );
};

const DraftTicketCard = ({
  viewModel,
  recyclingKey,
  actions,
}: {
  viewModel: TicketCardViewModel;
  recyclingKey: string;
  actions: TicketCardActions;
}): ReactElement => {
  const { canPressButtons: canInteract, isSubmitting, executeAction } = actions;
  const muted = useCSSVariable('--color-muted-text') as string;
  // Which button the user tapped. The submit flag from the flow hook is shared
  // by the whole card, so only the tapped button shows the spinner.
  const [pendingKey, setPendingKey] = useRecyclingState<string | null>(
    `${recyclingKey}:ticket-pending`,
    null,
  );
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isSubmitting;

  const run = (button: FlowActionButton): void => {
    if (busy || !canInteract) return;
    setPendingKey(button.key);
    setInFlight(true);
    void executeAction(button.action).finally(() => setInFlight(false));
  };

  return (
    <View style={{ alignSelf: 'stretch', width: '100%', minWidth: 0, gap: 10 }}>
      <View
        className='w-full gap-3 rounded-xl border border-dashed border-border bg-chat-card px-3 py-3'
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
        </View>
      </View>

      {viewModel.buttons.length > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 8, width: '100%' }}>
          {viewModel.buttons.map(button => (
            <TicketActionButton
              key={button.key}
              button={button}
              loading={busy && pendingKey === button.key}
              disabled={!canInteract || busy}
              onPress={() => run(button)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
};

/**
 * Native renderer for the FlowJSON `ticket` artifact, shared by chat v2 and v3.
 *  - proposed: the approval card an agent posts before `spaces-create-ticket` runs.
 *  - created: rendered with the same `TicketCard` the chat uses for ticket
 *    messages; tapping it opens the ticket (card-click only, like web).
 */
export const FlowTicketCard = memo(function FlowTicketCard({
  component,
  recyclingKey,
  containerStyle,
  actions,
}: {
  component: FlowComponentLike;
  recyclingKey: string;
  containerStyle?: StyleProp<ViewStyle>;
  actions: TicketCardActions;
}): ReactElement | null {
  const router = useRouter();
  const viewModel = createTicketCardViewModel(component);
  const link = viewModel?.link;

  const openTicket = useCallback((): void => {
    if (!link) return;
    const url = buildWebTicketLinkFromIds({ ...link, selectedTab: 'overview' });
    if (url && navigateToTicketDeepLinkIfApplicable(router, url)) return;
    openTicketDeepLink(router, { ...link, selectedTab: 'overview' });
  }, [link, router]);

  if (!viewModel) return null;

  if (viewModel.phase === 'proposed') {
    return (
      <View
        style={[{ alignSelf: 'stretch', width: '100%', minWidth: 0 }, containerStyle]}
        accessibilityLabel={`Ticket draft: ${viewModel.title}`}
      >
        <DraftTicketCard viewModel={viewModel} recyclingKey={recyclingKey} actions={actions} />
      </View>
    );
  }

  const card = <TicketCard ticket={toTicketPreview(viewModel)} mine={false} />;
  return (
    <View
      style={[{ alignSelf: 'stretch', width: '100%', minWidth: 0 }, containerStyle]}
      accessibilityLabel={`Ticket ${viewModel.idLabel}: ${viewModel.title}`}
    >
      {link ? (
        <Pressable onPress={openTicket} accessibilityRole='button'>
          {card}
        </Pressable>
      ) : (
        card
      )}
    </View>
  );
});
FlowTicketCard.displayName = 'FlowTicketCard';
