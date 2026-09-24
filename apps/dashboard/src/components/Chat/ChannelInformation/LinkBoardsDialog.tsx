import { ReactElement, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { ChevronRight, CheckTickSingle as Check, SearchDefault as Search } from '@xyne/icons';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { useChannelBoards } from '../../../hooks/useChannelBoards';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import { cn } from '../../../utils/classNames';

interface LinkBoardsDialogProps {
  channelId: string;
  channelName?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface BoardLite {
  id: string;
  name: string;
}

interface ProjectLite {
  id: string;
  name: string;
}

interface ProjectRowProps {
  project: ProjectLite;
  selected: ReadonlySet<string>;
  locked: ReadonlySet<string>;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleBoard: (boardId: string) => void;
}

/** Boards load only once the project is expanded — there can be a lot of both. */
function ProjectRow({
  project,
  selected,
  locked,
  expanded,
  onToggleExpand,
  onToggleBoard,
}: ProjectRowProps): ReactElement {
  const [boards, boardsDetails] = useCachedQuery(
    queries.boardsListByProject({ projectId: project.id }),
    { enabled: expanded },
  );
  const boardList = (boards ?? []) as readonly BoardLite[];

  const linkedCount = boardList.filter(board => locked.has(board.id)).length;
  const selectedCount = boardList.filter(board => selected.has(board.id)).length;

  return (
    <div className='py-0.5'>
      <button
        type='button'
        onClick={onToggleExpand}
        className='w-full flex items-center gap-2 px-2 py-2 rounded-md transition-colors hover:bg-muted text-left'
        data-track-category='Channel'
        data-track-name='ToggleLinkBoardsProject'
      >
        <ChevronRight
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <span className='flex-1 min-w-0 truncate text-sm text-foreground'>{project.name}</span>
        {selectedCount > 0 && (
          <span className='shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium tabular-nums text-primary-foreground'>
            +{selectedCount}
          </span>
        )}
        {expanded && linkedCount > 0 && (
          <span className='shrink-0 text-[11px] tabular-nums text-muted-foreground'>
            {linkedCount} linked
          </span>
        )}
      </button>

      {expanded && (
        <div className='ml-6 flex flex-col'>
          {boardsDetails.type !== 'complete' && boardList.length === 0 ? (
            <span className='px-2 py-2 text-xs text-muted-foreground'>Loading boards…</span>
          ) : boardList.length === 0 ? (
            <span className='px-2 py-2 text-xs text-muted-foreground'>No boards</span>
          ) : (
            boardList.map(board => {
              const isLinked = locked.has(board.id);
              const isSelected = selected.has(board.id);
              return (
                <button
                  key={board.id}
                  type='button'
                  disabled={isLinked}
                  onClick={() => onToggleBoard(board.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors outline-none',
                    isLinked && 'cursor-not-allowed opacity-60',
                    !isLinked && isSelected && 'bg-accent text-accent-foreground',
                    !isLinked && !isSelected && 'hover:bg-muted text-foreground',
                  )}
                  data-track-category='Channel'
                  data-track-name='ToggleLinkBoard'
                >
                  <span className='flex-1 min-w-0 truncate text-sm'>{board.name}</span>
                  {isLinked ? (
                    <span className='shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
                      Linked
                    </span>
                  ) : (
                    isSelected && <Check className='size-4 shrink-0' strokeWidth={2.5} />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Links boards to a channel (channel_board_mappings).
 *
 * Additive only — there is no unlink here. Already-linked boards are listed as
 * disabled "Linked" rows so the current state is visible without implying it can
 * be undone.
 */
export const LinkBoardsDialog = ({
  channelId,
  channelName,
  open,
  onOpenChange,
}: LinkBoardsDialogProps): ReactElement => {
  const zero = useZero();
  const { boards: linkedBoards } = useChannelBoards(channelId);
  const [pendingBoardIds, setPendingBoardIds] = useState<string[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [projects] = useCachedQuery(queries.getAllProjectsList(), { enabled: open });

  const locked = useMemo(() => new Set(linkedBoards.map(board => board.id)), [linkedBoards]);
  const selected = useMemo(() => new Set(pendingBoardIds), [pendingBoardIds]);

  // Each opening starts from a clean slate; leftover picks from a previous visit
  // would silently link boards the user chose in a session they abandoned.
  useEffect(() => {
    if (open) {
      setPendingBoardIds([]);
      setExpandedProjects(new Set());
      setSearch('');
    }
  }, [open]);

  // A board linked by someone else while this dialog was open is already linked;
  // drop it from the pending set so it is not submitted twice.
  const newBoardIds = useMemo(
    () => pendingBoardIds.filter(id => !locked.has(id)),
    [pendingBoardIds, locked],
  );

  const filteredProjects = useMemo(() => {
    const list = (projects ?? []) as readonly ProjectLite[];
    const query = search.trim().toLowerCase();
    return query ? list.filter(project => project.name.toLowerCase().includes(query)) : list;
  }, [projects, search]);

  const handleToggleBoard = (boardId: string): void => {
    setPendingBoardIds(prev =>
      prev.includes(boardId) ? prev.filter(id => id !== boardId) : [...prev, boardId],
    );
  };

  const handleToggleExpand = (projectId: string): void => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleSave = async (): Promise<void> => {
    if (newBoardIds.length === 0) return;
    setIsSaving(true);
    try {
      const result = zero.mutate(
        mutators.channel.linkBoards({
          channelId,
          boards: newBoardIds.map(boardId => ({ mappingId: uuidv4(), boardId })),
          timestamp: Date.now(),
        }),
      );
      // Wait for the server, not the optimistic apply — the permission check runs
      // there, and a rejected link must not be reported as a success.
      const response = await result.server;
      if (response?.type === 'error') {
        throw new Error(response.error.message || 'Could not link boards');
      }
      toast.success(
        newBoardIds.length === 1 ? 'Board linked' : `${newBoardIds.length} boards linked`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not link boards');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Link boards'
      description={
        channelName
          ? `Tickets from the boards you link appear in #${channelName}.`
          : 'Tickets from the boards you link appear in this channel.'
      }
      className='max-w-md rounded-2xl'
    >
      <div className='flex flex-col gap-4 p-5'>
        <div className='flex flex-col gap-1'>
          <h2 className='text-base font-semibold text-foreground'>Link boards</h2>
          <p className='text-sm text-muted-foreground'>
            {channelName
              ? `Tickets from the boards you link appear in #${channelName}.`
              : 'Tickets from the boards you link appear in this channel.'}{' '}
            Boards from any project can be linked.
          </p>
        </div>

        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            autoFocus
            type='text'
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder='Search projects…'
            className='pl-9 h-9'
          />
        </div>

        <div className='max-h-72 min-h-[9rem] overflow-y-auto rounded-lg border border-border p-1'>
          {filteredProjects.length === 0 ? (
            <div className='flex h-32 items-center justify-center px-4 text-center text-sm text-muted-foreground'>
              {search ? 'No matching projects' : 'No projects found'}
            </div>
          ) : (
            filteredProjects.map(project => (
              <ProjectRow
                key={project.id}
                project={project}
                selected={selected}
                locked={locked}
                expanded={expandedProjects.has(project.id)}
                onToggleExpand={() => handleToggleExpand(project.id)}
                onToggleBoard={handleToggleBoard}
              />
            ))
          )}
        </div>

        <div className='flex items-center justify-between gap-3'>
          <span className='text-xs text-muted-foreground'>
            {newBoardIds.length === 0
              ? 'Select a project to see its boards'
              : `${newBoardIds.length} board${newBoardIds.length > 1 ? 's' : ''} selected`}
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => onOpenChange(false)}
              data-track-category='Channel'
              data-track-name='CancelLinkBoards'
            >
              Cancel
            </Button>
            <Button
              size='sm'
              onClick={() => void handleSave()}
              disabled={newBoardIds.length === 0 || isSaving}
              data-track-category='Channel'
              data-track-name='ConfirmLinkBoards'
            >
              {isSaving ? 'Linking…' : 'Link boards'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

export default LinkBoardsDialog;
