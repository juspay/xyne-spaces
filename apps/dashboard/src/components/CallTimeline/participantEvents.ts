/**
 * Joins and leaves as points on the call timeline.
 *
 * `CallParticipant` is one row per person holding only the latest `joinedAt` and
 * `leftAt`, so a rejoin overwrites the earlier join and each person yields at
 * most one of each. Every occurrence would need an append-only event table.
 */

export type ParticipantEventType = 'join' | 'leave';

export interface ParticipantEvent {
  type: ParticipantEventType;
  name: string;
  /** Offset onto the timeline's axis, in seconds. */
  timestampSeconds: number;
}

/** Nearby events share one glyph, so a staggered arrival reads as one arrival. */
export interface ParticipantEventCluster {
  /** Chronological; a single-entry cluster renders as a bare triangle. */
  events: ParticipantEvent[];
  /** Position of the cluster — its earliest event. */
  timestampSeconds: number;
}

export interface ParticipantTimes {
  name: string;
  /** Epoch ms, as Zero syncs them. */
  joinedAt?: number | null | undefined;
  leftAt?: number | null | undefined;
}

/** Fraction of the track within which two events collapse into one cluster. */
const CLUSTER_SPAN_FRACTION = 0.025;

/**
 * The timeline counts from the first spoken line, but joins and leaves are wall
 * clock. Nothing records that instant yet, so this falls back to the call's start
 * — the assumption the Scribe bar makes too — at the cost of a uniform shift by
 * however long the call sat silent. Persisting `transcriptStartedAtMs` retires it.
 */
export function participantEventOriginMs(startedAtMs: number, metadata: unknown): number {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const stored = (metadata as { transcriptStartedAtMs?: unknown }).transcriptStartedAtMs;
    if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
  }
  return startedAtMs;
}

/** Chronological joins and leaves, measured from `originMs`. */
export function buildParticipantEvents(
  participants: readonly ParticipantTimes[],
  originMs: number,
): ParticipantEvent[] {
  const events: ParticipantEvent[] = [];

  for (const participant of participants) {
    const name = participant.name.trim() || 'Someone';

    // Anyone already in the room when the first word landed belongs at the start
    // of the track rather than off the left of it.
    if (typeof participant.joinedAt === 'number' && Number.isFinite(participant.joinedAt)) {
      events.push({
        type: 'join',
        name,
        timestampSeconds: Math.max(0, Math.round((participant.joinedAt - originMs) / 1000)),
      });
    }
    if (typeof participant.leftAt === 'number' && Number.isFinite(participant.leftAt)) {
      events.push({
        type: 'leave',
        name,
        timestampSeconds: Math.max(0, Math.round((participant.leftAt - originMs) / 1000)),
      });
    }
  }

  return events.sort((left, right) => left.timestampSeconds - right.timestampSeconds);
}

/**
 * Collapse events that would overlap on the track. Grouping is measured against
 * the first event of the run rather than the previous one, so a long trickle of
 * arrivals cannot chain into a single cluster spanning half the timeline.
 */
export function clusterParticipantEvents(
  events: readonly ParticipantEvent[],
  spanSeconds: number,
): ParticipantEventCluster[] {
  if (events.length === 0 || spanSeconds <= 0) return [];

  const threshold = spanSeconds * CLUSTER_SPAN_FRACTION;
  const clusters: ParticipantEventCluster[] = [];

  for (const event of events) {
    const current = clusters[clusters.length - 1];
    if (current && event.timestampSeconds - current.timestampSeconds <= threshold) {
      current.events.push(event);
      continue;
    }
    clusters.push({ events: [event], timestampSeconds: event.timestampSeconds });
  }

  return clusters;
}
