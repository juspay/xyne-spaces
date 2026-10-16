// ---------------------------------------------------------------------------
// Mobile take on the dashboard's CallTimelineBar: a read-only track of a
// finished call — recorded stretches shaded in, decision / action dots,
// a flag per marked moment, joins and leaves underneath. The dots are too
// small to aim at on a phone, so every marker is also listed below the track.
// ---------------------------------------------------------------------------

import { memo, useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Flag, Play, Video } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { haptics } from '@/src/utils/haptics';

import {
  formatOffset,
  trackFraction,
  type MarkedItem,
  type ParticipantEvent,
  type RecordedSpan,
} from '../utils/call-detail-format';

const DECISION_COLOR = '#EAB308';
const ACTION_COLOR = '#F97316';
const MOMENT_COLOR = '#EF4444';
const JOIN_COLOR = '#059669';
const COLLAPSED_COUNT = 4;

const MARKER_LABEL: Record<MarkedItem['type'], string> = {
  decision: 'Decision',
  action: 'Action item',
  moment: 'Marked moment',
};

const markerColor = (type: MarkedItem['type']): string =>
  type === 'decision' ? DECISION_COLOR : type === 'action' ? ACTION_COLOR : MOMENT_COLOR;

function percent(seconds: number, span: number): `${number}%` {
  return `${trackFraction(seconds, span) * 100}%`;
}

/** Joins/leaves closer than 2.5% of the track share one glyph. */
function clusterEvents(
  events: readonly ParticipantEvent[],
  span: number,
): Array<{ at: number; events: ParticipantEvent[] }> {
  const threshold = span * 0.025;
  const clusters: Array<{ at: number; events: ParticipantEvent[] }> = [];
  for (const event of events) {
    const current = clusters[clusters.length - 1];
    if (current && event.timestampSeconds - current.at <= threshold) {
      current.events.push(event);
    } else {
      clusters.push({ at: event.timestampSeconds, events: [event] });
    }
  }
  return clusters;
}

export interface CallTimelineCardProps {
  spanSeconds: number;
  markedItems: MarkedItem[];
  participantEvents: ParticipantEvent[];
  recordedSpans: RecordedSpan[];
  onMarkerPress: (item: MarkedItem) => void;
  onRecordingPress: (span: RecordedSpan, index: number) => void;
}

export const CallTimelineCard = memo(function CallTimelineCard({
  spanSeconds,
  markedItems,
  participantEvents,
  recordedSpans,
  onMarkerPress,
  onRecordingPress,
}: CallTimelineCardProps): ReactElement {
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const [expanded, setExpanded] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);

  const clusters = useMemo(
    () => clusterEvents(participantEvents, spanSeconds),
    [participantEvents, spanSeconds],
  );
  const listed = expanded ? markedItems : markedItems.slice(0, COLLAPSED_COUNT);
  const counts = useMemo(() => {
    const result = { decision: 0, action: 0, moment: 0 };
    for (const item of markedItems) result[item.type] += 1;
    return result;
  }, [markedItems]);
  const selectedCluster = selectedEvent !== null ? clusters[selectedEvent] : undefined;

  return (
    <View className='rounded-2xl border border-border bg-card px-4 pt-3.5 pb-3 gap-3'>
      <View className='flex-row items-center justify-between'>
        <Text className='text-[13px] font-semibold text-foreground'>Call timeline</Text>
        <Text
          className='text-[12px] text-secondary-foreground'
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {`0:00 – ${formatOffset(spanSeconds)}`}
        </Text>
      </View>

      {/* Track */}
      <View style={{ height: 34, justifyContent: 'center' }}>
        <View className='h-1.5 rounded-full bg-secondary overflow-hidden'>
          {recordedSpans.map(span => (
            <View
              key={span.recordingId}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: percent(span.startSeconds, spanSeconds),
                width: `${Math.max(1.2, (trackFraction(span.endSeconds, spanSeconds) - trackFraction(span.startSeconds, spanSeconds)) * 100)}%`,
                backgroundColor: span.kind === 'video' ? foreground : muted,
                opacity: span.kind === 'video' ? 0.7 : 0.45,
              }}
            />
          ))}
        </View>
        {markedItems.map((item, index) => {
          const color = markerColor(item.type);
          const left = percent(item.timestampSeconds, spanSeconds);
          return (
            <Pressable
              key={`${item.type}-${item.timestampSeconds}-${index}`}
              hitSlop={6}
              accessibilityRole='button'
              accessibilityLabel={`${MARKER_LABEL[item.type]} at ${formatOffset(item.timestampSeconds)}`}
              onPress={(): void => {
                void haptics.selection();
                onMarkerPress(item);
              }}
              style={{
                position: 'absolute',
                left,
                marginLeft: -7,
                width: 14,
                height: 34,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {item.type === 'moment' ? (
                <View style={{ alignItems: 'center', marginTop: -10 }}>
                  <Flag size={12} color={color} fill={color} />
                  <View style={{ width: 1.5, height: 8, backgroundColor: color }} />
                </View>
              ) : (
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: color,
                    borderWidth: 2,
                    borderColor: 'rgba(255,255,255,0.85)',
                  }}
                />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Joins / leaves */}
      {clusters.length > 0 ? (
        <View style={{ height: 14, marginTop: -8 }}>
          {clusters.map((cluster, index) => {
            const joins = cluster.events.filter(event => event.type === 'join').length;
            const isJoin = joins >= cluster.events.length - joins;
            return (
              <Pressable
                key={`${cluster.at}-${index}`}
                hitSlop={8}
                onPress={(): void =>
                  setSelectedEvent(current => (current === index ? null : index))
                }
                accessibilityRole='button'
                accessibilityLabel={`${cluster.events.length} join or leave events at ${formatOffset(cluster.at)}`}
                style={{
                  position: 'absolute',
                  left: percent(cluster.at, spanSeconds),
                  marginLeft: -5,
                }}
              >
                <Text style={{ fontSize: 9, lineHeight: 12, color: isJoin ? JOIN_COLOR : muted }}>
                  {isJoin ? '▲' : '▼'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {selectedCluster ? (
        <Text className='text-[12px] leading-4 text-secondary-foreground'>
          {selectedCluster.events
            .map(
              event =>
                `${event.name} ${event.type === 'join' ? 'joined' : 'left'} at ${formatOffset(event.timestampSeconds)}`,
            )
            .join(' · ')}
        </Text>
      ) : null}

      {/* Legend */}
      <View className='flex-row flex-wrap items-center gap-x-3 gap-y-1'>
        {counts.decision > 0 ? (
          <LegendDot
            color={DECISION_COLOR}
            label={`${counts.decision} decision${counts.decision === 1 ? '' : 's'}`}
          />
        ) : null}
        {counts.action > 0 ? (
          <LegendDot
            color={ACTION_COLOR}
            label={`${counts.action} action${counts.action === 1 ? '' : 's'}`}
          />
        ) : null}
        {counts.moment > 0 ? (
          <LegendDot
            color={MOMENT_COLOR}
            label={`${counts.moment} moment${counts.moment === 1 ? '' : 's'}`}
          />
        ) : null}
        {recordedSpans.length > 0 ? <LegendDot color={muted} label='Recorded' bar /> : null}
        {clusters.length > 0 ? (
          <View className='flex-row items-center gap-1'>
            <Text style={{ fontSize: 9, color: JOIN_COLOR }}>▲</Text>
            <Text className='text-[11.5px] text-secondary-foreground'>Joins</Text>
          </View>
        ) : null}
      </View>

      {/* Recordings */}
      {recordedSpans.length > 0 ? (
        <View className='flex-row flex-wrap gap-2'>
          {recordedSpans.map((span, index) => (
            <Pressable
              key={span.recordingId}
              onPress={(): void => {
                void haptics.buttonTap();
                onRecordingPress(span, index);
              }}
              accessibilityRole='button'
              accessibilityLabel={`Play ${span.name ?? `recording ${index + 1}`}`}
              className='flex-row items-center gap-1.5 h-8 rounded-full bg-secondary px-3 active:opacity-70'
            >
              {span.kind === 'video' ? (
                <Video size={13} color={foreground} />
              ) : (
                <Play size={12} color={foreground} fill={foreground} />
              )}
              <Text
                numberOfLines={1}
                className='text-[12.5px] font-medium text-foreground max-w-[170px]'
              >
                {span.name || `Recording ${index + 1}`}
              </Text>
              <Text className='text-[11.5px] text-secondary-foreground'>
                {formatOffset(span.startSeconds)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Key moments list */}
      {markedItems.length > 0 ? (
        <View className='gap-0.5 pt-1'>
          {listed.map((item, index) => (
            <Pressable
              key={`row-${item.type}-${item.timestampSeconds}-${index}`}
              onPress={(): void => onMarkerPress(item)}
              accessibilityRole='button'
              className='flex-row items-start gap-2.5 rounded-lg py-1.5 active:opacity-60'
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  marginTop: 6,
                  backgroundColor: markerColor(item.type),
                }}
              />
              <Text className='flex-1 text-[13.5px] leading-5 text-foreground' numberOfLines={2}>
                {item.text || MARKER_LABEL[item.type]}
              </Text>
              <Text
                className='text-[12px] leading-5 text-secondary-foreground'
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatOffset(item.timestampSeconds)}
              </Text>
            </Pressable>
          ))}
          {markedItems.length > COLLAPSED_COUNT ? (
            <Pressable
              onPress={(): void => setExpanded(value => !value)}
              hitSlop={6}
              className='pt-1 active:opacity-60'
            >
              <Text className='text-[12.5px] font-medium text-secondary-foreground'>
                {expanded ? 'Show less' : `Show all ${markedItems.length}`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

function LegendDot({
  color,
  label,
  bar = false,
}: {
  color: string;
  label: string;
  bar?: boolean;
}): ReactElement {
  return (
    <View className='flex-row items-center gap-1.5'>
      <View
        style={
          bar
            ? { width: 14, height: 5, borderRadius: 3, backgroundColor: color, opacity: 0.5 }
            : { width: 7, height: 7, borderRadius: 4, backgroundColor: color }
        }
      />
      <Text className='text-[11.5px] text-secondary-foreground'>{label}</Text>
    </View>
  );
}
