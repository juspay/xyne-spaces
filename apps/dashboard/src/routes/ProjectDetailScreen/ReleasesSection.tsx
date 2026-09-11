/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RocketShip as Rocket } from '@xyne/icons';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { ReleaseStagePicker } from '../../components/Release/ReleaseStagePicker';
import { buildStagesByBoard } from '../../components/Release/releaseChanges.utils';
import { readReleaseInsights } from '../../components/Release/ReleaseInsightsPanel';
import { BoardType } from '@xyne/shared';

interface ReleasesSectionProps {
  projectId: string;
}

function StatChip({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className='rounded-md border border-border bg-muted/40 px-3 py-1.5'>
      <span className='text-sm font-semibold text-foreground'>{value}</span>
      <span className='ml-1.5 text-xs text-muted-foreground'>{label}</span>
    </div>
  );
}

/**
 * Table of release tickets in the project. Each row navigates to ReleaseDetailScreen.
 * Driven by `releaseTicketsByProjectId` (returns Tickets with ticketType=Release for
 * this project).
 */
export const ReleasesSection = ({ projectId }: ReleasesSectionProps): ReactElement => {
  const navigate = useNavigate();
  const [releaseTickets] = useCachedQuery(queries.releaseTicketsByProjectId({ projectId }), {
    enabled: !!projectId,
  });

  // Stages for every release board in the project. Each release ticket sits on
  // its own board (project-level `<name>_releases` or per-app `<app>_release`),
  // so we group by boardId and feed the right list to the per-row picker.
  // Release tickets only ever sit on RELEASE boards — don't sync dev-board stages.
  const [stages] = useCachedQuery(
    queries.stagesByBoards({ projectId, boardType: BoardType.RELEASE }),
    { enabled: !!projectId },
  );
  const stagesByBoard = useMemo(() => buildStagesByBoard(stages), [stages]);

  // Deterministic cross-release roll-up. Total / this-month / status come from
  // every release row; the shipped-work sums come from analyzed releases only.
  const metrics = useMemo(() => {
    const tickets = releaseTickets ?? [];
    const now = new Date();
    let thisMonth = 0;
    let analyzed = 0;
    let devTickets = 0;
    let hotfixes = 0;
    let migrations = 0;
    let envChanges = 0;
    const byStatus = new Map<string, number>();
    const byContributor = new Map<string, number>();
    for (const t of tickets) {
      const created = new Date(t.createdAt);
      if (created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear()) {
        thisMonth++;
      }
      const status = t.statusV2 || 'Unknown';
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
      const stats = readReleaseInsights(t.metadata)?.stats;
      if (!stats) continue;
      analyzed++;
      devTickets += stats.devTicketCount ?? 0;
      hotfixes += stats.hotfixCount ?? 0;
      migrations += stats.migrationFileCount ?? 0;
      envChanges += stats.environmentVariableCount ?? 0;
      for (const c of stats.contributors ?? []) {
        if (c?.name)
          byContributor.set(c.name, (byContributor.get(c.name) ?? 0) + (c.ticketCount ?? 0));
      }
    }
    const topContributors = [...byContributor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      total: tickets.length,
      thisMonth,
      analyzed,
      devTickets,
      hotfixes,
      migrations,
      envChanges,
      byStatus: [...byStatus.entries()].sort((a, b) => b[1] - a[1]),
      topContributors,
    };
  }, [releaseTickets]);

  if (!releaseTickets || releaseTickets.length === 0) {
    return (
      <div className='text-center py-8 bg-muted rounded-lg border border-dashed border-border'>
        <Rocket size={32} className='mx-auto text-muted-foreground mb-2' />
        <p className='text-sm text-muted-foreground'>
          No releases yet. Release tickets created on this project will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className='mb-4 rounded-lg border border-border bg-background p-4'>
        <div className='mb-3 flex items-center justify-between gap-3'>
          <h3 className='text-sm font-semibold text-foreground'>Release metrics</h3>
          <span className='text-xs text-muted-foreground'>
            {metrics.analyzed}/{metrics.total} analyzed
          </span>
        </div>
        <div className='flex flex-wrap gap-2'>
          <StatChip label='releases' value={metrics.total} />
          <StatChip label='this month' value={metrics.thisMonth} />
          <StatChip label='dev tickets shipped' value={metrics.devTickets} />
          <StatChip label='hotfixes' value={metrics.hotfixes} />
          <StatChip label='migrations' value={metrics.migrations} />
          <StatChip label='env changes' value={metrics.envChanges} />
        </div>
        {metrics.byStatus.length > 0 && (
          <div className='mt-3 flex flex-wrap items-center gap-1.5'>
            <span className='text-xs text-muted-foreground'>Status:</span>
            {metrics.byStatus.map(([status, n]) => (
              <span
                key={status}
                className='rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'
              >
                {status} · {n}
              </span>
            ))}
          </div>
        )}
        {metrics.topContributors.length > 0 && (
          <div className='mt-2 flex flex-wrap items-center gap-1.5'>
            <span className='text-xs text-muted-foreground'>Top contributors:</span>
            {metrics.topContributors.map(([name, n]) => (
              <span
                key={name}
                className='rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'
              >
                {name} · {n}
              </span>
            ))}
          </div>
        )}
        {metrics.analyzed < metrics.total && (
          <p className='mt-3 text-xs text-muted-foreground'>
            Shipped-work totals count the {metrics.analyzed} analyzed release
            {metrics.analyzed === 1 ? '' : 's'}. Run “Analyze release” on the rest to include them.
          </p>
        )}
      </div>
      <div className='border border-border rounded-lg overflow-hidden'>
        <table className='w-full text-sm'>
          <thead className='bg-muted text-left'>
            <tr>
              <th className='px-4 py-2 font-medium'>Release Id</th>
              <th className='px-4 py-2 font-medium'>Title</th>
              <th className='px-4 py-2 font-medium min-w-[120px]'>Status</th>
              <th className='px-4 py-2 font-medium min-w-[160px]'>Stage</th>
              <th className='px-4 py-2 font-medium'>Created</th>
            </tr>
          </thead>
          <tbody>
            {releaseTickets.map(ticket => (
              <tr
                key={ticket.id}
                onClick={() => void navigate(`/listProjects/${projectId}/releases/${ticket.id}`)}
                data-track-category='ProjectDetail'
                data-track-name='OPEN_RELEASE_ROW'
                className='border-t border-border hover:bg-muted/50 cursor-pointer transition-colors'
              >
                <td className='px-4 py-2 font-mono text-xs text-muted-foreground'>
                  {ticket.xyneId || '—'}
                </td>
                <td className='px-4 py-2 font-medium'>{ticket.title || 'Release ticket'}</td>
                <td className='px-4 py-2'>
                  <span className='text-xs px-2 py-0.5 rounded bg-background border border-border'>
                    {ticket.statusV2}
                  </span>
                </td>
                <td className='px-4 py-2'>
                  <ReleaseStagePicker
                    ticketId={ticket.id}
                    stageName={ticket.stageName}
                    statusV2={ticket.statusV2}
                    boardId={ticket.boardId}
                    stages={stagesByBoard.get(ticket.boardId) ?? []}
                  />
                </td>
                <td className='px-4 py-2 text-xs text-muted-foreground'>
                  {new Date(ticket.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
