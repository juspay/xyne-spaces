interface LogIssueOccurrenceSource {
  body: string;
  createdAt: number;
}

interface LogIssueData {
  occurrenceCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  levelSourceText: string;
  stackTrace: string | null;
  timestamps: number[];
}

const STACK_TRACE_MARKER = /Stack trace:/i;
const STACK_FRAME_START = /\bat\s+.*:\d+:\d+/;

function splitLogDescription(description: string): string | null {
  const match = STACK_TRACE_MARKER.exec(description);
  if (match) {
    return description.slice(match.index + match[0].length).trim();
  }
  return STACK_FRAME_START.test(description) ? description.trim() : null;
}

export function deriveLogIssueData(occurrences: LogIssueOccurrenceSource[]): LogIssueData | null {
  if (occurrences.length === 0) return null;
  let earliest = occurrences[0]!;
  let latest = occurrences[0]!;
  for (const occurrence of occurrences) {
    if (occurrence.createdAt < earliest.createdAt) earliest = occurrence;
    if (occurrence.createdAt > latest.createdAt) latest = occurrence;
  }
  const stackTrace = splitLogDescription(latest.body);
  return {
    occurrenceCount: occurrences.length,
    firstSeenAt: earliest.createdAt,
    lastSeenAt: latest.createdAt,
    levelSourceText: latest.body,
    stackTrace,
    timestamps: occurrences.map(o => o.createdAt),
  };
}
