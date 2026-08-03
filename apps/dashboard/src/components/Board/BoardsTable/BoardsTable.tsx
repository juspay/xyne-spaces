/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useMemo, useState } from 'react';
import { Edit2, Copy, Check, Rocket, CornerDownRight } from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { Button } from '../../ui/Button';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { toast } from 'sonner';
import { getBoardEditLabel } from '../BoardCard';
import type { BoardWithStages } from '../BoardCard';

// Minimal shape we read off Application — kept inline so callers can pass any
// superset (e.g. the full Zero row) without us having to import the whole type.
type ApplicationLite = {
  id: string;
  name: string;
  boardId: string;
  mainReleaseBoardId?: string | null;
};

interface BoardsTableProps {
  boards: readonly BoardWithStages[] | undefined;
  onEdit: (board: BoardWithStages) => void;
  applicationBoardIds?: Set<string>;
  // Map from app-board-id → Application row. Used to (a) detect app boards,
  // (b) show the human application name, (c) group app boards under their
  // mainReleaseBoardId. When omitted the table renders flat (old behaviour).
  applicationByBoardId?: Map<string, ApplicationLite>;
  // Called when a row is clicked (anywhere outside the action buttons). The
  // row already carries `cursor-pointer` styling; without a handler it looks
  // clickable but does nothing.
  onBoardClick?: (board: BoardWithStages) => void;
}

type RowKind =
  | { type: 'standalone'; board: BoardWithStages }
  | { type: 'releaseGroupHeader'; mainBoard: BoardWithStages; appCount: number }
  | { type: 'orphanReleaseGroupHeader'; mainBoardId: string; appCount: number } // group whose main board isn't in the boards list
  | { type: 'appChild'; board: BoardWithStages; application: ApplicationLite };

export const BoardsTable = ({
  boards,
  onEdit,
  applicationBoardIds,
  applicationByBoardId,
  onBoardClick,
}: BoardsTableProps): ReactElement => {
  const [copiedBoardId, setCopiedBoardId] = useState<string | null>(null);

  const handleCopyId = (e: React.MouseEvent, boardId: string): void => {
    e.stopPropagation();
    copyTextToClipboard(boardId)
      .then(() => {
        toast.success('Board ID copied to clipboard');
        setCopiedBoardId(boardId);
        setTimeout(() => setCopiedBoardId(null), 1500);
      })
      .catch(() => {
        toast.error('Failed to copy board ID');
      });
  };

  // Group rows: each release board with its app boards underneath, then any
  // standalone boards at the bottom. Preserves the input order of the main
  // release boards so callers can still control "newest first" etc.
  const rows: RowKind[] = useMemo(() => {
    const boardList = boards ?? [];
    if (!applicationByBoardId || applicationByBoardId.size === 0) {
      return boardList.map<RowKind>(board => ({ type: 'standalone', board }));
    }

    const boardById = new Map(boardList.map(b => [b.id, b]));
    const groups = new Map<string, ApplicationLite[]>();
    for (const app of applicationByBoardId.values()) {
      if (!app.mainReleaseBoardId) continue;
      const existing = groups.get(app.mainReleaseBoardId) ?? [];
      existing.push(app);
      groups.set(app.mainReleaseBoardId, existing);
    }

    const mainReleaseBoardIds = new Set(groups.keys());
    const claimedAppBoardIds = new Set<string>();
    const out: RowKind[] = [];

    for (const board of boardList) {
      if (mainReleaseBoardIds.has(board.id)) {
        const apps = groups.get(board.id) ?? [];
        out.push({ type: 'releaseGroupHeader', mainBoard: board, appCount: apps.length });
        for (const app of apps) {
          const appBoard = boardById.get(app.boardId);
          if (!appBoard) continue; // app exists but its board isn't synced — skip
          claimedAppBoardIds.add(app.boardId);
          out.push({ type: 'appChild', board: appBoard, application: app });
        }
        continue;
      }
      // App board whose parent release board is NOT in this list — render it as
      // a standalone so it isn't lost. (Edge case; e.g. cross-project releases.)
      if (applicationByBoardId.has(board.id) && !claimedAppBoardIds.has(board.id)) {
        const app = applicationByBoardId.get(board.id)!;
        if (app.mainReleaseBoardId && !boardById.has(app.mainReleaseBoardId)) {
          // Emit a synthetic header once per orphan parent so the user sees
          // *something* explaining the indent.
          const alreadyEmitted = out.some(
            r => r.type === 'orphanReleaseGroupHeader' && r.mainBoardId === app.mainReleaseBoardId,
          );
          if (!alreadyEmitted) {
            out.push({
              type: 'orphanReleaseGroupHeader',
              mainBoardId: app.mainReleaseBoardId,
              appCount: groups.get(app.mainReleaseBoardId)?.length ?? 1,
            });
          }
          out.push({ type: 'appChild', board, application: app });
          claimedAppBoardIds.add(board.id);
          continue;
        }
      }
      if (claimedAppBoardIds.has(board.id)) continue;

      out.push({ type: 'standalone', board });
    }

    return out;
  }, [boards, applicationByBoardId]);

  if (boards?.length === 0) {
    return (
      <EmptyState
        title='No boards yet'
        description='Create your first board to get started'
        icon='📋'
      />
    );
  }

  return (
    <div className='bg-background rounded-lg shadow-sm border border-border overflow-hidden'>
      <table className='min-w-full divide-y divide-border'>
        <thead className='bg-muted'>
          <tr>
            <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
              Board Name
            </th>
            <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
              Board ID
            </th>
            <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
              Created Date
            </th>
            <th className='px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider'>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className='bg-background divide-y divide-border'>
          {rows.map(row => {
            if (row.type === 'releaseGroupHeader') {
              const { mainBoard, appCount } = row;
              return (
                <tr
                  key={`group-${mainBoard.id}`}
                  className='bg-muted/40 hover:bg-muted transition-colors cursor-pointer'
                  onClick={onBoardClick ? () => onBoardClick(mainBoard) : undefined}
                >
                  <td className='px-6 py-3 whitespace-nowrap'>
                    <div className='flex items-center gap-2'>
                      <Rocket size={14} className='text-muted-foreground' />
                      <span className='text-sm font-semibold text-foreground'>
                        {mainBoard.name}
                      </span>
                      <span className='text-xs text-muted-foreground'>
                        · {appCount} application{appCount === 1 ? '' : 's'}
                      </span>
                    </div>
                  </td>
                  <td className='px-6 py-3 whitespace-nowrap'>
                    <div className='flex items-center gap-1'>
                      <code className='text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[140px] inline-block'>
                        {mainBoard.id}
                      </code>
                      <Button
                        variant='ghost'
                        size='iconSm'
                        className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
                        onClick={e => handleCopyId(e, mainBoard.id)}
                        title='Copy board ID'
                      >
                        {copiedBoardId === mainBoard.id ? <Check size={12} /> : <Copy size={12} />}
                      </Button>
                    </div>
                  </td>
                  <td className='px-6 py-3 whitespace-nowrap'>
                    <div className='text-sm text-muted-foreground'>
                      {new Date(mainBoard.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td
                    className='px-6 py-3 whitespace-nowrap text-right text-sm font-medium'
                    onClick={e => e.stopPropagation()}
                  >
                    <div className='flex items-center justify-end gap-2'>
                      <Button
                        variant='secondary'
                        onClick={() => onEdit(mainBoard)}
                        data-testid='edit-board-button'
                        data-track-category='Board'
                        data-track-name='Edit_Board_Table'
                        data-track-metadata={JSON.stringify({
                          boardId: mainBoard.id,
                          boardName: mainBoard.name,
                        })}
                      >
                        <Edit2 size={14} />
                        {getBoardEditLabel(mainBoard, applicationBoardIds)}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            }

            if (row.type === 'orphanReleaseGroupHeader') {
              return (
                <tr key={`orphan-${row.mainBoardId}`} className='bg-muted/40'>
                  <td className='px-6 py-3 whitespace-nowrap' colSpan={4}>
                    <div className='flex items-center gap-2'>
                      <Rocket size={14} className='text-muted-foreground' />
                      <span className='text-sm font-medium text-muted-foreground italic'>
                        Release group · main board not in this project
                      </span>
                    </div>
                  </td>
                </tr>
              );
            }

            if (row.type === 'appChild') {
              const { board, application } = row;
              return (
                <tr
                  key={board.id}
                  className='hover:bg-muted transition-colors cursor-pointer'
                  onClick={onBoardClick ? () => onBoardClick(board) : undefined}
                >
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <div className='flex items-center gap-2 pl-6'>
                      <CornerDownRight size={12} className='text-muted-foreground' />
                      <span className='text-sm font-medium text-foreground'>
                        {application.name}
                      </span>
                      <span className='text-xs text-muted-foreground' title={board.name}>
                        application
                      </span>
                    </div>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <div className='flex items-center gap-1'>
                      <code className='text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[140px] inline-block'>
                        {board.id}
                      </code>
                      <Button
                        variant='ghost'
                        size='iconSm'
                        className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
                        onClick={e => handleCopyId(e, board.id)}
                        title='Copy board ID'
                      >
                        {copiedBoardId === board.id ? <Check size={12} /> : <Copy size={12} />}
                      </Button>
                    </div>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <div className='text-sm text-muted-foreground'>
                      {new Date(board.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td
                    className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium'
                    onClick={e => e.stopPropagation()}
                  >
                    <div className='flex items-center justify-end gap-2'>
                      <Button
                        variant='secondary'
                        onClick={() => onEdit(board)}
                        data-testid='edit-board-button'
                        data-track-category='Board'
                        data-track-name='Edit_Board_Table'
                        data-track-metadata={JSON.stringify({
                          boardId: board.id,
                          boardName: board.name,
                        })}
                      >
                        <Edit2 size={14} />
                        {getBoardEditLabel(board, applicationBoardIds)}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            }

            // standalone
            const { board } = row;
            return (
              <tr
                key={board.id}
                className='hover:bg-muted transition-colors cursor-pointer'
                onClick={onBoardClick ? () => onBoardClick(board) : undefined}
              >
                <td className='px-6 py-4 whitespace-nowrap'>
                  <span className='text-sm font-medium text-muted-foreground'>{board.name}</span>
                </td>
                <td className='px-6 py-4 whitespace-nowrap'>
                  <div className='flex items-center gap-1'>
                    <code className='text-xs bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[140px] inline-block'>
                      {board.id}
                    </code>
                    <Button
                      variant='ghost'
                      size='iconSm'
                      className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
                      onClick={e => handleCopyId(e, board.id)}
                      title='Copy board ID'
                    >
                      {copiedBoardId === board.id ? <Check size={12} /> : <Copy size={12} />}
                    </Button>
                  </div>
                </td>
                <td className='px-6 py-4 whitespace-nowrap'>
                  <div className='text-sm text-muted-foreground'>
                    {new Date(board.createdAt).toLocaleDateString()}
                  </div>
                </td>
                <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium'>
                  <div
                    className='flex items-center justify-end gap-2'
                    onClick={e => e.stopPropagation()}
                    role='button'
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                      }
                    }}
                    data-track-category='Board'
                    data-track-name='Board_Actions_Container'
                    data-track-metadata={JSON.stringify({ boardId: board.id })}
                  >
                    <Button
                      variant='secondary'
                      onClick={() => onEdit(board)}
                      data-testid='edit-board-button'
                      data-track-category='Board'
                      data-track-name='Edit_Board_Table'
                      data-track-metadata={JSON.stringify({
                        boardId: board.id,
                        boardName: board.name,
                      })}
                    >
                      <Edit2 size={14} />
                      {getBoardEditLabel(board, applicationBoardIds)}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
