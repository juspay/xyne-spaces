import { serializeCsv, type ReleaseReportDevTicket } from '@xyne/shared';
import type { ChangeCounts } from '../../components/Release/releaseChanges.utils';

interface ArtRowInput {
  readonly id: string;
  readonly ticketId: string;
  readonly testedBy?: string | null | undefined;
  readonly failureReason?: string | null | undefined;
  // Release-scoped: this dev ticket entered the release as a hotfix.
  readonly isHotfix?: boolean | null | undefined;
  readonly subTicket?:
    | {
        readonly mappedTicket?: { readonly boardId?: string | null | undefined } | null | undefined;
      }
    | null
    | undefined;
  devTicket?:
    | {
        readonly id: string;
        readonly xyneId: string;
        readonly title: string;
        readonly assignedTo?: string | null | undefined;
        readonly createdBy?: string | null | undefined;
        readonly ticketType?: string | null | undefined;
        readonly channelId: string;
        readonly conversationId: string;
        readonly boardId: string;
        readonly stageName: string;
        readonly priority?: string | null | undefined;
        readonly eta?: number | null | undefined;
        readonly merchantId?: string | null | undefined;
        readonly pullRequests?:
          | readonly {
              readonly prId: number;
              readonly prUrl: string;
            }[]
          | null
          | undefined;
        readonly workflows?:
          | readonly { readonly workflowType?: string | null | undefined }[]
          | null
          | undefined;
        readonly tags?: readonly { readonly name?: string | null | undefined }[] | null | undefined;
        readonly formEntityValues?:
          | readonly {
              readonly fieldId: string;
              readonly fieldValue?: string | null | undefined;
              readonly actualFieldValue?: unknown;
            }[]
          | null
          | undefined;
      }
    | null
    | undefined;
}

// Addable (optional) columns exposed by the "Add column" picker for CORE ticket
// fields. Fields already shown as base columns (Dev Owner=assignedTo, Type,
// Status) are intentionally excluded. Custom fields are appended at runtime.
export const CORE_ADDABLE_DEV_TICKET_COLUMNS: readonly { key: string; label: string }[] = [
  { key: 'core:priority', label: 'Priority' },
  { key: 'core:eta', label: 'Due Date' },
  { key: 'core:workflowType', label: 'Workflow' },
  { key: 'core:merchantId', label: 'Merchant ID' },
  { key: 'core:tags', label: 'Labels' },
];

interface UserInput {
  readonly id: string;
  readonly name?: string | null | undefined;
  readonly email?: string | null | undefined;
}

export interface ReleaseDetailDevTicketRow extends ReleaseReportDevTicket {
  internalTicketId: string;
  channelId: string | null;
  conversationId: string | null;
  boardId: string | null;
  appReleaseBoardId: string | null;
  artId: string;
  failureReason: string | null;
  testedBy: string | null;
  prId: number | null;
  changeCounts: ChangeCounts | undefined;
  isHotfix: boolean;
  // Addable-column values (see CORE_ADDABLE_DEV_TICKET_COLUMNS + custom fields).
  priority: string;
  dueDate: string;
  workflow: string;
  merchantId: string;
  labels: string;
  customValuesByFieldId: Map<string, string>;
}

// Resolves the display string for any addable column key (core:* or custom:<fieldId>).
export function devTicketAddableCellValue(row: ReleaseDetailDevTicketRow, key: string): string {
  if (key.startsWith('custom:')) return row.customValuesByFieldId.get(key.slice(7)) || '—';
  switch (key) {
    case 'core:priority':
      return row.priority || '—';
    case 'core:eta':
      return row.dueDate || '—';
    case 'core:workflowType':
      return row.workflow || '—';
    case 'core:merchantId':
      return row.merchantId || '—';
    case 'core:tags':
      return row.labels || '—';
    default:
      return '—';
  }
}

// Produces table text such as 2 env, 1 mig, or —.
function formatChanges(counts?: ChangeCounts): string {
  const values: string[] = [];
  if (counts?.env) values.push(`${counts.env} env`);
  if (counts?.mig) values.push(`${counts.mig} mig`);
  return values.length > 0 ? values.join(', ') : '—';
}

// Converts ART rows into display-ready rows. It deduplicates tickets,
// resolves owner IDs to names/emails, resolves current stage/type, attaches QA information, and preserves internal IDs required by
// stage and navigation flows.

export function buildReleaseDetailDevTicketRows(
  artRows: readonly ArtRowInput[] | null | undefined,
  users: readonly UserInput[] | null | undefined,
  changeCountsByDevTicket: Map<string, ChangeCounts>,
  // 'ticket' (default) = one row per ticket (flat table/CSV); 'ticketAndBoard' =
  // one per (ticket, app board) so a cross-repo ticket reaches every repo group.
  options?: { readonly dedupeBy?: 'ticket' | 'ticketAndBoard' },
): ReleaseDetailDevTicketRow[] {
  const dedupeBy = options?.dedupeBy ?? 'ticket';
  const usersById = new Map(
    (users ?? []).map(user => [user.id, user.name ?? user.email ?? user.id]),
  );
  /**
   * Resolve a user id to a display name, falling back to the raw id when the user isn't
   * loaded. Returns null only when no id is set, so callers can chain fallbacks.
   */
  const resolveUser = (userId: string | null | undefined): string | null =>
    userId ? (usersById.get(userId) ?? userId) : null;
  const seen = new Set<string>();
  const rows: ReleaseDetailDevTicketRow[] = [];

  for (const artRow of artRows ?? []) {
    const dedupeKey =
      dedupeBy === 'ticketAndBoard'
        ? `${artRow.ticketId}|${artRow.subTicket?.mappedTicket?.boardId ?? ''}`
        : artRow.ticketId;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const devTicket = artRow.devTicket;
    const ticketId = devTicket?.xyneId ?? artRow.ticketId;
    const changeCounts = changeCountsByDevTicket.get(ticketId);
    const customValuesByFieldId = new Map<string, string>();
    for (const fev of devTicket?.formEntityValues ?? []) {
      const actual = fev.actualFieldValue;
      const actualStr =
        typeof actual === 'string'
          ? actual
          : actual === null || actual === undefined
            ? ''
            : JSON.stringify(actual);
      // actualFieldValue is the source of truth the ticket UI reads/writes;
      // fieldValue is a legacy column kept empty by the form mutators, used
      // only as a fallback for older rows.
      const value = actualStr || fev.fieldValue;
      if (value) customValuesByFieldId.set(fev.fieldId, value);
    }
    // Dev owner precedence: assignee -> creator (reporter) -> 'Unknown'.
    // Only 'Unknown' when neither the assignee nor the creator resolves to a user.
    const assignedOwner = resolveUser(devTicket?.assignedTo);
    const reportedOwner = resolveUser(devTicket?.createdBy);
    rows.push({
      internalTicketId: artRow.ticketId,
      ticketId,
      title: devTicket?.title ?? artRow.ticketId,
      devOwner: assignedOwner ?? reportedOwner ?? 'Unknown',
      type: devTicket?.ticketType ?? '',
      status: devTicket?.stageName ?? 'Unknown',
      changes: formatChanges(changeCounts),
      qaOwner: resolveUser(artRow.testedBy) ?? 'Unassigned',
      prId: devTicket?.pullRequests?.[0]?.prId ?? null,
      prUrl: devTicket?.pullRequests?.[0]?.prUrl ?? null,
      channelId: devTicket?.channelId ?? null,
      conversationId: devTicket?.conversationId ?? null,
      boardId: devTicket?.boardId ?? null,
      appReleaseBoardId: artRow.subTicket?.mappedTicket?.boardId ?? null,
      artId: artRow.id,
      failureReason: artRow.failureReason ?? null,
      testedBy: artRow.testedBy ?? null,
      changeCounts,
      isHotfix: artRow.isHotfix ?? false,
      priority: devTicket?.priority ?? '',
      dueDate: devTicket?.eta ? new Date(devTicket.eta).toLocaleDateString() : '',
      workflow: (devTicket?.workflows ?? []).find(w => w.workflowType)?.workflowType ?? '',
      merchantId: devTicket?.merchantId ?? '',
      labels: (devTicket?.tags ?? [])
        .map(t => t.name)
        .filter((n): n is string => !!n)
        .join(', '),
      customValuesByFieldId,
    });
  }

  return rows;
}

export interface RepoRangeInput {
  readonly mainReleaseBoardId: string;
  readonly deployedCommit?: string | null | undefined;
  readonly newCommit?: string | null | undefined;
}

export interface RepoApplicationInput {
  readonly boardId: string;
  readonly mainReleaseBoardId?: string | null | undefined;
  readonly repoUrl?: string | null | undefined;
  readonly name?: string | null | undefined;
}

export interface DevTicketRepoGroup {
  key: string;
  repoUrl: string | null;
  fallbackName: string | null;
  rangeFrom: string | null;
  rangeTo: string | null;
  rows: ReleaseDetailDevTicketRow[];
  testedCount: number;
  totalCount: number;
}

function isRowTested(row: ReleaseDetailDevTicketRow): boolean {
  return !!row.testedBy && !row.failureReason;
}

export function groupDevTicketRowsByRepo(
  rows: readonly ReleaseDetailDevTicketRow[],
  repos: readonly RepoRangeInput[] | null | undefined,
  applications: readonly RepoApplicationInput[] | null | undefined,
): { groups: DevTicketRepoGroup[]; unmapped: ReleaseDetailDevTicketRow[] } {
  const boardToRepo = new Map<string, string>();
  const repoMeta = new Map<string, { repoUrl: string | null; name: string | null }>();
  for (const app of applications ?? []) {
    if (app.mainReleaseBoardId) {
      if (app.boardId) boardToRepo.set(app.boardId, app.mainReleaseBoardId);
      if (!repoMeta.has(app.mainReleaseBoardId)) {
        repoMeta.set(app.mainReleaseBoardId, {
          repoUrl: app.repoUrl ?? null,
          name: app.name ?? null,
        });
      }
    }
  }

  // Dedup by ticket within each repo bucket (several apps can map to one repo),
  // so tested/total counts aren't inflated.
  const rowsByRepo = new Map<string, ReleaseDetailDevTicketRow[]>();
  const seenByRepo = new Map<string, Set<string>>();
  const unmapped: ReleaseDetailDevTicketRow[] = [];
  const seenUnmapped = new Set<string>();
  for (const row of rows) {
    const repoId = row.appReleaseBoardId ? boardToRepo.get(row.appReleaseBoardId) : undefined;
    if (repoId) {
      let bucket = rowsByRepo.get(repoId);
      if (!bucket) {
        bucket = [];
        rowsByRepo.set(repoId, bucket);
      }
      let seenTickets = seenByRepo.get(repoId);
      if (!seenTickets) {
        seenTickets = new Set<string>();
        seenByRepo.set(repoId, seenTickets);
      }
      if (seenTickets.has(row.internalTicketId)) continue;
      seenTickets.add(row.internalTicketId);
      bucket.push(row);
    } else {
      if (seenUnmapped.has(row.internalTicketId)) continue;
      seenUnmapped.add(row.internalTicketId);
      unmapped.push(row);
    }
  }

  const rangeByRepo = new Map<string, RepoRangeInput>();
  for (const repo of repos ?? []) {
    if (!rangeByRepo.has(repo.mainReleaseBoardId)) rangeByRepo.set(repo.mainReleaseBoardId, repo);
  }

  // Snapshot repos first, then any board a row actually mapped to — so a row
  // never vanishes when live config drifts from the release snapshot.
  const orderedKeys = [
    ...rangeByRepo.keys(),
    ...[...rowsByRepo.keys()].filter(key => !rangeByRepo.has(key)),
  ];

  const groups: DevTicketRepoGroup[] = [];
  for (const key of orderedKeys) {
    const groupRows = rowsByRepo.get(key);
    if (!groupRows || groupRows.length === 0) continue;
    const meta = repoMeta.get(key);
    const range = rangeByRepo.get(key);
    groups.push({
      key,
      repoUrl: meta?.repoUrl ?? null,
      fallbackName: meta?.name ?? null,
      rangeFrom: range?.deployedCommit ?? null,
      rangeTo: range?.newCommit ?? null,
      rows: groupRows,
      testedCount: groupRows.filter(isRowTested).length,
      totalCount: groupRows.length,
    });
  }

  return { groups, unmapped };
}

export function shortenRef(ref: string | null | undefined): string {
  if (!ref) return '';
  return /^[0-9a-f]{12,}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

export function buildDevTicketsCsv(
  rows: ReleaseDetailDevTicketRow[],
  addedColumns: readonly { key: string; label: string }[] = [],
): string {
  return serializeCsv(
    [
      'Ticket Id',
      'Title',
      'Dev Owner',
      'Type',
      'Status',
      'Changes',
      'QA Owner',
      'PR URL',
      'Is Hotfix',
      ...addedColumns.map(col => col.label),
    ],
    rows.map(row => [
      row.ticketId,
      row.title,
      row.devOwner,
      row.type,
      row.status,
      row.changes,
      row.qaOwner,
      row.prUrl ?? '',
      row.isHotfix ? 'Yes' : 'No',
      ...addedColumns.map(col => devTicketAddableCellValue(row, col.key)),
    ]),
  );
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildDevTicketsCsvFilename(
  releaseTicketId: string | null | undefined,
  releaseVersion: string | null | undefined,
  date = new Date(),
): string {
  const parts = [
    sanitizeFilenamePart(releaseTicketId || 'release'),
    releaseVersion ? sanitizeFilenamePart(releaseVersion) : null,
    'dev-tickets',
    date.toISOString().slice(0, 10),
  ].filter((part): part is string => Boolean(part));

  return `${parts.join('-')}.csv`;
}

export function downloadCsvFile(csv: string, filename: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
