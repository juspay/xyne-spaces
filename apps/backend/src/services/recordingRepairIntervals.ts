import type {
  RecordingRepairOutage,
  RecordingRepairReason,
} from '@/services/recordingRepairStateService';

const REASONS = new Set<RecordingRepairReason>([
  'browser_offline',
  'livekit_disconnected',
  'reconnect_timeout',
  'agent_left',
  'stt_failed',
]);

export interface RecordingRepairCoverage {
  startedAt: number;
  endedAt: number;
}

function normalizeCoverage(
  coverage: RecordingRepairCoverage[],
): RecordingRepairCoverage[] {
  return coverage
    .filter(interval => Number.isFinite(interval.startedAt) && interval.endedAt > interval.startedAt)
    .sort((left, right) => left.startedAt - right.startedAt || left.endedAt - right.endedAt);
}

export function validateRecordingRepairOutages(value: unknown): RecordingRepairOutage[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Outages are required');
  const outages = value.map(item => {
    const candidate = item as { startedAt?: unknown; endedAt?: unknown; reasons?: unknown };
    const startedAt = new Date(typeof candidate.startedAt === 'string' ? candidate.startedAt : '').getTime();
    const endedAt = new Date(typeof candidate.endedAt === 'string' ? candidate.endedAt : '').getTime();
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
      throw new Error('Invalid outage timestamps');
    }
    if (!Array.isArray(candidate.reasons) || candidate.reasons.length === 0) {
      throw new Error('Each outage requires at least one reason');
    }
    const reasons = candidate.reasons as RecordingRepairReason[];
    if (new Set(reasons).size !== reasons.length || reasons.some(reason => !REASONS.has(reason))) {
      throw new Error('Invalid outage reasons');
    }
    return { startedAt, endedAt, reasons: [...reasons].sort() };
  });
  for (let index = 1; index < outages.length; index += 1) {
    if (outages[index].startedAt < outages[index - 1].endedAt) {
      throw new Error('Outages must be ordered and non-overlapping');
    }
  }
  return outages;
}

export function coalesceRecordingRepairCoverage(
  chunks: RecordingRepairCoverage[],
): RecordingRepairCoverage[] {
  const sorted = normalizeCoverage(chunks);
  const coverage: RecordingRepairCoverage[] = [];
  for (const chunk of sorted) {
    const previous = coverage[coverage.length - 1];
    if (previous && chunk.startedAt <= previous.endedAt) {
      previous.endedAt = Math.max(previous.endedAt, chunk.endedAt);
    } else {
      coverage.push({ ...chunk });
    }
  }
  return coverage;
}

export function intersectRecordingRepairCoverage(
  chunks: RecordingRepairCoverage[],
  outages: RecordingRepairCoverage[],
): RecordingRepairCoverage[] {
  const normalizedChunks = normalizeCoverage(chunks);
  const normalizedOutages = normalizeCoverage(outages);
  const intersections: RecordingRepairCoverage[] = [];

  for (const chunk of normalizedChunks) {
    for (const outage of normalizedOutages) {
      const startedAt = Math.max(chunk.startedAt, outage.startedAt);
      const endedAt = Math.min(chunk.endedAt, outage.endedAt);
      if (endedAt > startedAt) intersections.push({ startedAt, endedAt });
      if (outage.startedAt >= chunk.endedAt) break;
    }
  }

  return coalesceRecordingRepairCoverage(intersections);
}

export function outagesAreFullyCovered(
  outages: RecordingRepairCoverage[],
  chunks: RecordingRepairCoverage[],
): boolean {
  const normalizedOutages = normalizeCoverage(outages);
  const covered = intersectRecordingRepairCoverage(chunks, normalizedOutages);

  let coverageIndex = 0;
  for (const outage of normalizedOutages) {
    let cursor = outage.startedAt;
    while (coverageIndex < covered.length && covered[coverageIndex]!.endedAt <= cursor) {
      coverageIndex += 1;
    }
    let scanIndex = coverageIndex;
    while (scanIndex < covered.length) {
      const interval = covered[scanIndex]!;
      if (interval.startedAt > cursor) return false;
      cursor = Math.max(cursor, interval.endedAt);
      if (cursor >= outage.endedAt) break;
      scanIndex += 1;
    }
    if (cursor < outage.endedAt) return false;
    coverageIndex = scanIndex;
  }

  return true;
}
