import { memo, useMemo, type ReactElement, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Clock, Target } from 'lucide-react-native';
import { parseTicketMd } from '@xyne/shared';

import { MONO_FONT } from '@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle';
import { getSenderAvatarFallbackUser } from '@/src/features/chat/v2/paint/chatPaintAvatarFallback';
import type { TicketPreview } from '@/src/features/chat/v2/paint/chatPaint.types';
import { AvatarFace } from '@/src/ui/avatar';

import {
  TICKET_ASSIGNEE_SIZE,
  TICKET_CARD_RADIUS,
  TICKET_DATE_ICON_SIZE,
  TICKET_META_GAP,
  TICKET_META_LINE_HEIGHT,
  TICKET_META_MARK_GAP,
  TICKET_NOTCH_RADIUS,
  TICKET_NUMBER_GAP,
  TICKET_NUMBER_ICON_SIZE,
  TICKET_NUMBER_ROW_HEIGHT,
  TICKET_PRIORITY_BAR_GAP,
  TICKET_PRIORITY_BAR_HEIGHTS,
  TICKET_PRIORITY_BAR_RADIUS,
  TICKET_PRIORITY_BAR_WIDTH,
  TICKET_STATUS_FILL,
  TICKET_STATUS_RING,
  TICKET_STATUS_SIZE,
  TICKET_STUB_GAP,
  TICKET_STUB_PADDING_X,
  TICKET_STUB_PADDING_Y,
  TICKET_STUB_RADIUS,
  TICKET_TITLE_LINE_HEIGHT,
  TICKET_TITLE_MAX_LINES,
} from '../constants';
import {
  ticketCardModel,
  type TicketPriorityMark,
  type TicketStatusGlyph,
} from '../model/ticket-card';
import { useConversationPalette } from './conversation-palette';
import { MessageCardFrame } from './message-card-frame';

const STUB_STYLE = {
  paddingHorizontal: TICKET_STUB_PADDING_X,
  paddingVertical: TICKET_STUB_PADDING_Y,
  rowGap: TICKET_STUB_GAP,
} as const;

// Each notch is a circle of the frame's grey centred on the stub's edge; the stub clips it to a half.
const NOTCH_STYLE = {
  position: 'absolute',
  top: '50%',
  marginTop: -TICKET_NOTCH_RADIUS,
  width: TICKET_NOTCH_RADIUS * 2,
  height: TICKET_NOTCH_RADIUS * 2,
  borderRadius: TICKET_NOTCH_RADIUS,
} as const;
const LEFT_NOTCH_STYLE = { ...NOTCH_STYLE, left: -TICKET_NOTCH_RADIUS } as const;
const RIGHT_NOTCH_STYLE = { ...NOTCH_STYLE, right: -TICKET_NOTCH_RADIUS } as const;

const NUMBER_STYLE = { fontFamily: MONO_FONT, fontSize: 13, letterSpacing: 0.52 } as const;
const META_TEXT_CLASS = 'text-[12px] leading-4 text-spaces-muted';

type TicketCardProps = {
  ticket: TicketPreview;
  /** The conversation's ticket record, for the status stage and the ETA the preview leaves out. */
  ticketMd: string | null | undefined;
  /**
   * Makes the card its own tap target (the thread's parent ticket). Without
   * it the card is inert and the row's tap opens the ticket.
   */
  onPress?: (() => void) | undefined;
  /** Passed with `onPress`, so the card's own pressable does not swallow the hold. */
  onLongPress?: (() => void) | undefined;
};

/**
 * A ticket in a message (Figma "Ticket / Card"): a stub notched where the
 * number meets the title, holding only what recognises the ticket.
 */
export const TicketCard = memo(function TicketCard({
  ticket,
  ticketMd,
  onPress,
  onLongPress,
}: TicketCardProps): ReactElement {
  const { subtle } = useConversationPalette();
  const record = useMemo(() => parseTicketMd(ticketMd ?? null), [ticketMd]);
  const model = useMemo(() => ticketCardModel(ticket, record), [record, ticket]);
  const assignee = getSenderAvatarFallbackUser(ticket.assignee);

  const label = onPress
    ? [
        `Ticket ${model.number}`,
        model.title,
        model.status.label,
        model.priority?.label,
        model.dueLabel ? `due ${model.dueLabel}` : undefined,
      ]
        .filter(Boolean)
        .join(', ')
    : undefined;

  return (
    <MessageCardFrame
      radius={TICKET_CARD_RADIUS}
      innerRadius={TICKET_STUB_RADIUS}
      innerStyle={STUB_STYLE}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole='button'
      accessibilityLabel={label}
      accessibilityHint='Opens the ticket'
    >
      <View className='bg-spaces-surface' style={LEFT_NOTCH_STYLE} />
      <View className='bg-spaces-surface' style={RIGHT_NOTCH_STYLE} />
      <View
        className='flex-row items-center'
        style={{ height: TICKET_NUMBER_ROW_HEIGHT, columnGap: TICKET_NUMBER_GAP }}
      >
        <Target size={TICKET_NUMBER_ICON_SIZE} color={subtle} strokeWidth={1.33} />
        <Text className='min-w-0 flex-1 text-spaces-subtle' style={NUMBER_STYLE} numberOfLines={1}>
          {model.number}
        </Text>
        {assignee ? (
          <AvatarFace userId={assignee.id} size={TICKET_ASSIGNEE_SIZE} fallbackUser={assignee} />
        ) : null}
      </View>
      <Text
        className='text-[16px] font-medium tracking-[-0.24px] text-spaces-foreground'
        style={{ lineHeight: TICKET_TITLE_LINE_HEIGHT }}
        numberOfLines={TICKET_TITLE_MAX_LINES}
      >
        {model.title}
      </Text>
      <View className='flex-row flex-wrap items-center' style={{ columnGap: TICKET_META_GAP }}>
        <MetaItem mark={<StatusGlyph glyph={model.status.glyph} />}>{model.status.label}</MetaItem>
        {model.priority ? (
          <MetaItem mark={<PriorityBars priority={model.priority} />}>
            {model.priority.label}
          </MetaItem>
        ) : null}
        {model.dueLabel ? (
          <MetaItem mark={<Clock size={TICKET_DATE_ICON_SIZE} color={subtle} />}>
            {model.dueLabel}
          </MetaItem>
        ) : null}
      </View>
    </MessageCardFrame>
  );
});

/** A mark beside its word: status, priority or date. */
function MetaItem({ mark, children }: { mark: ReactElement; children: ReactNode }): ReactElement {
  return (
    <View className='flex-row items-center' style={{ columnGap: TICKET_META_MARK_GAP }}>
      {mark}
      <Text
        className={META_TEXT_CLASS}
        style={{ lineHeight: TICKET_META_LINE_HEIGHT }}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}

const RING_STYLE = {
  width: TICKET_STATUS_SIZE,
  height: TICKET_STATUS_SIZE,
  borderRadius: TICKET_STATUS_SIZE / 2,
  borderWidth: TICKET_STATUS_RING,
} as const;
const DASHED_RING_STYLE = { ...RING_STYLE, borderStyle: 'dashed' } as const;
const FILL_STYLE = {
  width: TICKET_STATUS_FILL,
  height: TICKET_STATUS_FILL,
  borderRadius: TICKET_STATUS_FILL / 2,
} as const;
const HALF_FILL_STYLE = { width: TICKET_STATUS_FILL / 2, height: TICKET_STATUS_FILL } as const;

const RING_CLASS: Readonly<Record<TicketStatusGlyph, string>> = {
  todo: 'border-spaces-subtle',
  inProgress: 'border-spaces-warning',
  done: 'border-spaces-positive',
  blocked: 'border-spaces-negative',
};

/** Figma "Ticket / Status": a 14 ring, its fill showing how far the ticket has got. */
function StatusGlyph({ glyph }: { glyph: TicketStatusGlyph }): ReactElement {
  return (
    <View
      className={`items-center justify-center ${RING_CLASS[glyph]}`}
      style={glyph === 'todo' ? DASHED_RING_STYLE : RING_STYLE}
    >
      {glyph === 'done' ? <View className='bg-spaces-positive' style={FILL_STYLE} /> : null}
      {glyph === 'inProgress' ? (
        <View className='flex-row overflow-hidden' style={FILL_STYLE}>
          <View style={HALF_FILL_STYLE} />
          <View className='bg-spaces-warning' style={HALF_FILL_STYLE} />
        </View>
      ) : null}
    </View>
  );
}

const BAR_STYLES = TICKET_PRIORITY_BAR_HEIGHTS.map(height => ({
  width: TICKET_PRIORITY_BAR_WIDTH,
  height,
  borderRadius: TICKET_PRIORITY_BAR_RADIUS,
}));

/** Figma "Ticket / Priority": three rising bars, as many lit as the priority is high. */
function PriorityBars({ priority }: { priority: TicketPriorityMark }): ReactElement {
  const litClass = priority.isUrgent ? 'bg-spaces-negative' : 'bg-spaces-foreground';
  return (
    <View className='flex-row items-end' style={{ columnGap: TICKET_PRIORITY_BAR_GAP }}>
      {BAR_STYLES.map((style, index) => (
        <View
          key={style.height}
          className={index < priority.lit ? litClass : 'bg-spaces-outline'}
          style={style}
        />
      ))}
    </View>
  );
}
