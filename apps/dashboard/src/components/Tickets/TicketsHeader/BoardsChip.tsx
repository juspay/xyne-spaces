import { ReactElement, useMemo, useState } from 'react';
import { KanbanBoard } from '@xyne/icons';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { ViewBoardPickerContent } from '../../Project/ViewBoardPicker/ViewBoardPicker';
import { BoardSubmenu } from '../TicketFilters/Submenus';
import type { BoardOption, TicketFilters } from '../TicketFilters/types';
import { FilterChip } from './FilterChip';
import { summarize } from './filterChips';
import type { FilterPickerContext } from './TicketsHeader.types';

interface BoardsChipProps {
  filters: TicketFilters;
  onFiltersChange: (filters: TicketFilters) => void;
  ctx: FilterPickerContext;
  workspaceView: boolean;
}

interface BoardLite {
  id: string;
  name: string;
}

export const BoardsChip = ({
  filters,
  onFiltersChange,
  ctx,
  workspaceView,
}: BoardsChipProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const selectedBoards = useMemo(() => filters.boards ?? [], [filters.boards]);

  const isMyTicketsMode = ctx.availableBoards !== undefined;
  const [projectBoards] = useCachedQuery(
    queries.boardsListByProject({ projectId: ctx.projectId || '' }),
    { enabled: !workspaceView && !isMyTicketsMode && hasOpened && !!ctx.projectId },
  );
  const [workspaceBoards] = useCachedQuery(queries.boardsByIds({ boardIds: selectedBoards }), {
    enabled: workspaceView && selectedBoards.length > 0,
  });

  const boardList: BoardOption[] = useMemo(() => {
    if (isMyTicketsMode) {
      if (!ctx.availableBoards || ctx.availableBoards.length === 0) return [];
      return ctx.availableBoardDetails ?? [];
    }
    return projectBoards ?? [];
  }, [isMyTicketsMode, ctx.availableBoards, ctx.availableBoardDetails, projectBoards]);

  const namesById = useMemo(() => {
    const map = new Map<string, string>();
    boardList.forEach(b => map.set(b.id, b.name));
    ((workspaceBoards ?? []) as readonly BoardLite[]).forEach(b => map.set(b.id, b.name));
    return map;
  }, [boardList, workspaceBoards]);

  const value = useMemo(() => {
    if (selectedBoards.length === 0) return workspaceView ? 'Select boards' : 'All boards';
    const labels: string[] = [];
    for (const id of selectedBoards) {
      const name =
        namesById.get(id) ?? (selectedBoards.length === 1 ? ctx.selectedBoardName : undefined);
      if (name === undefined) {
        return `${selectedBoards.length} ${selectedBoards.length === 1 ? 'board' : 'boards'}`;
      }
      labels.push(name);
    }
    return summarize(labels, 'boards');
  }, [selectedBoards, namesById, workspaceView, ctx.selectedBoardName]);

  const operator = selectedBoards.length > 1 ? 'is any of' : 'is';

  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    ctx.onBoardDropdownOpenChange?.(next);
    if (next && !hasOpened) setHasOpened(true);
  };

  const picker = workspaceView ? (
    <div className='w-72 rounded-lg border border-border bg-background shadow-lg'>
      {open && (
        <ViewBoardPickerContent
          selectedBoardIds={selectedBoards}
          onChange={boardIds => onFiltersChange({ ...filters, boards: boardIds })}
        />
      )}
    </div>
  ) : (
    <div className='min-w-[220px] rounded-lg border border-border bg-background shadow-lg'>
      <BoardSubmenu
        selectedBoards={selectedBoards}
        onChange={boards => {
          const next: TicketFilters = { ...filters, boards };
          delete next.stages;
          if (boards.length === 0) delete next.boards;
          onFiltersChange(next);
        }}
        onClose={() => handleOpenChange(false)}
        boards={boardList}
        allowAllBoards={ctx.allowAllBoards ?? true}
      />
    </div>
  );

  return (
    <FilterChip
      testId='filter-chip-boards'
      label={ctx.isNonLinearBoard ? 'Board · Non-linear' : 'Boards'}
      icon={<KanbanBoard />}
      operator={operator}
      value={value}
      removable={false}
      open={open}
      onOpenChange={handleOpenChange}
      picker={picker}
    />
  );
};
