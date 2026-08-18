export interface RecordingRepairCoverage {
  startedAt: number;
  endedAt: number;
}

function normalizeCoverage(coverage: RecordingRepairCoverage[]): RecordingRepairCoverage[] {
  return coverage
    .filter(
      (interval) => Number.isFinite(interval.startedAt) && interval.endedAt > interval.startedAt
    )
    .sort((left, right) => left.startedAt - right.startedAt || left.endedAt - right.endedAt);
}

export function coalesceRecordingRepairCoverage(
  chunks: RecordingRepairCoverage[]
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
