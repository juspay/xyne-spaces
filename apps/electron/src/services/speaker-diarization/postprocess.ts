/**
 * Pure post-processing for diarization output. Kept free of Electron imports so
 * it can be exercised from plain Node (see scratch checks) and from the worker.
 */

export interface RawSegment {
  start: number;
  end: number;
  speaker: number;
}

// A cluster is "minor" — almost certainly a cough, crosstalk, or one voice
// drifting — when it holds under this share of all speech AND under this many
// seconds in absolute terms. Both conditions must hold so a quiet participant
// in a long meeting (small share, but tens of seconds) is never merged away.
// Share is generous because short recordings inflate it: a real solo 63 s test
// produced a 4 s phantom cluster holding 11% of the speech.
export const MINOR_SPEAKER_MAX_SHARE = 0.2;
export const MINOR_SPEAKER_MAX_SECONDS = 20;

// Temporal smoothing: a short segment sandwiched between two segments of the
// same *other* speaker (or sitting at a recording edge next to a long one) is
// far more likely to be that speaker's voice mis-clustered — the first seconds
// of a voice, a cough, a laugh — than a genuine one-off interjection.
// Real two-person run: the first 2.7 s of speaker A was clustered with B, and a
// 0.7 s blip of B appeared mid-A; both are fixed by this rule.
export const SMOOTH_MAX_SEGMENT_SECONDS = 3;
export const SMOOTH_MAX_GAP_SECONDS = 3;
export const SMOOTH_EDGE_NEIGHBOUR_MIN_SECONDS = 5;

export function speechSecondsBySpeaker(segments: RawSegment[]): Record<number, number> {
  const totals: Record<number, number> = {};
  for (const segment of segments) {
    totals[segment.speaker] = Number(((totals[segment.speaker] ?? 0) + (segment.end - segment.start)).toFixed(2));
  }
  return totals;
}

/** Renumber speakers densely from 0 in order of first appearance. */
export function renumberSpeakers(segments: RawSegment[]): RawSegment[] {
  const map = new Map<number, number>();
  return segments.map((segment) => {
    if (!map.has(segment.speaker)) map.set(segment.speaker, map.size);
    return { ...segment, speaker: map.get(segment.speaker)! };
  });
}

/**
 * Reassign isolated short segments to the speaker surrounding them.
 * Iterates until stable so a run of two blips resolves too.
 */
export function smoothIsolatedSegments(input: RawSegment[]): { segments: RawSegment[]; smoothed: number } {
  const segments = [...input].sort((a, b) => a.start - b.start).map((s) => ({ ...s }));

  // Seconds of speech in the run of consecutive same-speaker segments starting
  // at `index` and walking in `direction`, stopping at a speaker change or a
  // gap wider than SMOOTH_MAX_GAP_SECONDS. A neighbour that opens a long run
  // counts as long even if its first segment is short.
  const runSeconds = (index: number, direction: 1 | -1): number => {
    const speaker = segments[index].speaker;
    let total = 0;
    for (let i = index; i >= 0 && i < segments.length; i += direction) {
      const segment = segments[i];
      if (segment.speaker !== speaker) break;
      if (i !== index) {
        const previous = segments[i - direction];
        const gap = direction === 1 ? segment.start - previous.end : previous.start - segment.end;
        if (gap > SMOOTH_MAX_GAP_SECONDS) break;
      }
      total += segment.end - segment.start;
    }
    return total;
  };

  let smoothed = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i];
      if (current.end - current.start > SMOOTH_MAX_SEGMENT_SECONDS) continue;
      const prev = i > 0 ? segments[i - 1] : null;
      const next = i < segments.length - 1 ? segments[i + 1] : null;
      const prevClose = prev && current.start - prev.end <= SMOOTH_MAX_GAP_SECONDS ? prev : null;
      const nextClose = next && next.start - current.end <= SMOOTH_MAX_GAP_SECONDS ? next : null;

      let target: number | null = null;
      if (prevClose && nextClose) {
        if (prevClose.speaker === nextClose.speaker && prevClose.speaker !== current.speaker) target = prevClose.speaker;
      } else if (prevClose || nextClose) {
        const onlyIndex = prevClose ? i - 1 : i + 1;
        const only = segments[onlyIndex];
        const neighbourRun = runSeconds(onlyIndex, prevClose ? -1 : 1);
        if (only.speaker !== current.speaker && neighbourRun >= SMOOTH_EDGE_NEIGHBOUR_MIN_SECONDS) {
          target = only.speaker;
        }
      }
      if (target !== null) {
        current.speaker = target;
        smoothed += 1;
        changed = true;
      }
    }
  }
  return { segments, smoothed };
}

/**
 * Fold minor clusters into the speaker of the temporally nearest non-minor
 * segment. Returns how many clusters were folded.
 */
export function mergeMinorSpeakers(segments: RawSegment[]): { segments: RawSegment[]; merged: number } {
  if (segments.length === 0) return { segments, merged: 0 };
  const totals = speechSecondsBySpeaker(segments);
  const totalSpeech = Object.values(totals).reduce((sum, v) => sum + v, 0);
  const minor = new Set(
    Object.entries(totals)
      .filter(([, seconds]) => seconds < MINOR_SPEAKER_MAX_SECONDS && seconds / totalSpeech < MINOR_SPEAKER_MAX_SHARE)
      .map(([speaker]) => Number(speaker)),
  );
  // Never merge everything away: if all clusters are minor (tiny recording), keep them.
  if (minor.size === 0 || minor.size === Object.keys(totals).length) return { segments, merged: 0 };

  const major = segments.filter((segment) => !minor.has(segment.speaker));
  const nearestMajorSpeaker = (segment: RawSegment): number => {
    let best = major[0];
    let bestGap = Infinity;
    for (const candidate of major) {
      const gap = candidate.start > segment.end ? candidate.start - segment.end : segment.start - candidate.end;
      if (gap < bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
    return best.speaker;
  };
  return {
    segments: segments.map((segment) =>
      minor.has(segment.speaker) ? { ...segment, speaker: nearestMajorSpeaker(segment) } : segment,
    ),
    merged: minor.size,
  };
}

/** Full pipeline: smooth blips → fold minor clusters → dense renumbering. */
export function postProcessSegments(raw: RawSegment[]): {
  segments: RawSegment[];
  smoothed: number;
  merged: number;
} {
  const { segments: smoothedSegments, smoothed } = smoothIsolatedSegments(raw);
  const { segments: mergedSegments, merged } = mergeMinorSpeakers(smoothedSegments);
  return { segments: renumberSpeakers(mergedSegments), smoothed, merged };
}
