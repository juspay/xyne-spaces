/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RocketShip as Rocket } from '@xyne/icons';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { ReleaseStagePicker } from '../../components/Release/ReleaseStagePicker';
import { buildStagesByBoard } from '../../components/Release/releaseChanges.utils';
import { BoardType } from '@xyne/shared';

interface ReleasesSectionProps {
  projectId: string;
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
  );
};
