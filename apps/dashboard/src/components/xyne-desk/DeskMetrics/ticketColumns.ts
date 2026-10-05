import type { DeskMetricsStageMove, DeskMetricsTicketRow } from '@xyne/shared';

/** Elapsed time as hh:mm:ss; hours run past 24, so a day and a half is 36:00:00. */
export const formatHms = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

/** One column for the per-primary-issue "sub issue: …" form fields. */
export const SUB_ISSUE_COLUMN = 'Sub Issue';

const SUB_ISSUE_FIELD = /^\s*sub[\s_-]*issues?\b/i;

export const isSubIssueField = (field: string): boolean => SUB_ISSUE_FIELD.test(field);

const fieldNames = (tickets: DeskMetricsTicketRow[]): Set<string> =>
  new Set(tickets.flatMap(ticket => Object.keys(ticket.customFields ?? {})));

/** Custom-field columns, sorted, with every sub-issue field folded into one. */
export const customFieldColumns = (tickets: DeskMetricsTicketRow[]): string[] =>
  [
    ...new Set(
      [...fieldNames(tickets)].map(field => (isSubIssueField(field) ? SUB_ISSUE_COLUMN : field)),
    ),
  ].sort();

/** The sub-issue fields behind SUB_ISSUE_COLUMN, for per-field guest visibility. */
export const subIssueFields = (tickets: DeskMetricsTicketRow[]): string[] =>
  [...fieldNames(tickets)].filter(isSubIssueField).sort();

/** A column's value; the sub-issue column joins every set sub-issue field the viewer may see. */
export const customFieldValue = (
  customFields: Record<string, string> | null,
  column: string,
  canSeeField: (field: string) => boolean = () => true,
): string => {
  if (column !== SUB_ISSUE_COLUMN) return customFields?.[column] ?? '';
  return Object.keys(customFields ?? {})
    .filter(field => isSubIssueField(field) && canSeeField(field))
    .sort()
    .map(field => customFields?.[field]?.trim() ?? '')
    .filter(value => value !== '')
    .join('; ');
};

/** "OPEN → IN_PROGRESS (00:05:12)": the move, and how long the ticket sat in `from`. */
export const formatStageMove = (move: DeskMetricsStageMove): string =>
  `${move.from} → ${move.to} (${formatHms(move.seconds)})`;

export const formatStageMoves = (moves: DeskMetricsStageMove[] | null): string =>
  (moves ?? []).map(formatStageMove).join('; ');
