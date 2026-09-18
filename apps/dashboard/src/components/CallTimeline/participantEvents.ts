/**
 * Joins and leaves as points on the call timeline.
 *
 * `CallParticipant` holds only the latest `joinedAt`/`leftAt` per person, so a
 * rejoin overwrites the earlier join and each person yields at most one of each.
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

/** Chronological joins and leaves, measured from `originMs`. */
export function buildParticipantEvents(
  participants: readonly ParticipantTimes[],
  originMs: number,
): ParticipantEvent[] {
  const events: ParticipantEvent[] = [];

  for (const participant of participants) {
    const name = participant.name.trim() || 'Someone';

    // Joined before the call was marked started: pin to the start.
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
 * Collapse events that would overlap. Measured against the run's first event, not
 * the previous one, so a trickle of arrivals cannot chain into one huge cluster.
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
