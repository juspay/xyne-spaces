import { serializeCsv, type ReleaseReportDevTicket } from '@xyne/shared';
import type { ChangeCounts } from '../../components/Release/releaseChanges.utils';

interface ArtRowInput {
  readonly id: string;
  readonly ticketId: string;
  readonly testedBy?: string | null | undefined;
  readonly failureReason?: string | null | undefined;
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
        readonly pullRequests?:
          | readonly {
              readonly prId: number;
              readonly prUrl: string;
            }[]
          | null
          | undefined;
      }
    | null
    | undefined;
}

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
  artId: string;
  failureReason: string | null;
  testedBy: string | null;
  prId: number | null;
  changeCounts: ChangeCounts | undefined;
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
): ReleaseDetailDevTicketRow[] {
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
    if (seen.has(artRow.ticketId)) continue;
    seen.add(artRow.ticketId);

    const devTicket = artRow.devTicket;
    const ticketId = devTicket?.xyneId ?? artRow.ticketId;
    const changeCounts = changeCountsByDevTicket.get(ticketId);
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
      artId: artRow.id,
      failureReason: artRow.failureReason ?? null,
      testedBy: artRow.testedBy ?? null,
      changeCounts,
    });
  }

  return rows;
}

export function buildDevTicketsCsv(rows: ReleaseDetailDevTicketRow[]): string {
  return serializeCsv(
    ['Ticket Id', 'Title', 'Dev Owner', 'Type', 'Status', 'Changes', 'QA Owner', 'PR URL'],
    rows.map(row => [
      row.ticketId,
      row.title,
      row.devOwner,
      row.type,
      row.status,
      row.changes,
      row.qaOwner,
      row.prUrl ?? '',
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
