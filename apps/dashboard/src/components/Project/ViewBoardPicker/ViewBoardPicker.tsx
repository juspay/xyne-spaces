import { ReactElement, useMemo, useState } from 'react';
import { ChevronRight, LayerTwo as Layers, SearchDefault as Search } from '@xyne/icons';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { cn } from '../../../utils/classNames';
import { Popover } from '../../ui/Popover/Popover';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import Button from '../../ui/Button';
import type { PickerProjectRowProps, ViewBoardPickerProps } from './ViewBoardPicker.types';

interface BoardLite {
  id: string;
  name: string;
}

interface ProjectLite {
  id: string;
  name: string;
}

// Boards are fetched lazily, only once the project is expanded.
function PickerProjectRow({
  project,
  selected,
  expanded,
  onToggleExpand,
  onToggleBoards,
}: PickerProjectRowProps): ReactElement {
  const [boards] = useCachedQuery(queries.boardsListByProject({ projectId: project.id }), {
    enabled: expanded,
  });
  const boardList = (boards ?? []) as readonly BoardLite[];

  const selectedInProject = boardList.filter(b => selected.has(b.id)).length;
  const allSelected = boardList.length > 0 && selectedInProject === boardList.length;
  const someSelected = selectedInProject > 0 && !allSelected;

  const handleToggleAll = (checked: boolean): void => {
    onToggleBoards(
      boardList.map(b => b.id),
      checked,
    );
  };

  return (
    <div data-slot='view-board-picker-project'>
      <button
        type='button'
        onClick={onToggleExpand}
        className='w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors hover:bg-muted group'
        data-track-category='Projects'
        data-track-name='TogglePickerProject'
      >
        <ChevronRight
          className={cn(
            'size-4 text-muted-foreground transition-transform',
            expanded ? 'rotate-90' : 'rotate-0',
          )}
        />
        <span className='flex-1 text-left text-[13px] text-foreground truncate group-hover:text-foreground'>
          {project.name}
        </span>
        {selectedInProject > 0 && (
          <span className='text-[11px] tabular-nums text-primary-foreground bg-primary px-1.5 py-0.5 rounded-full'>
            {selectedInProject}
          </span>
        )}
      </button>

      {expanded && (
        <div className='ml-6 mt-0.5 mb-1 flex flex-col gap-1'>
          {boardList.length === 0 ? (
            <div className='px-2 py-1.5 text-[12px] text-muted-foreground'>No boards</div>
          ) : (
            <>
              <div className='px-2 py-1'>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={handleToggleAll}
                  label='All boards'
                />
              </div>
              {boardList.map(board => (
                <div key={board.id} className='px-2 py-1'>
                  <Checkbox
                    checked={selected.has(board.id)}
                    onChange={checked => onToggleBoards([board.id], checked)}
                    label={board.name}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ViewBoardPicker({
  selectedBoardIds,
  onChange,
  className,
}: ViewBoardPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(new Set());

  const [projects] = useCachedQuery(queries.getAllProjectsList(), { enabled: open });
  const selected = useMemo(() => new Set(selectedBoardIds), [selectedBoardIds]);

  const filteredProjects = useMemo(() => {
    const list = (projects ?? []) as readonly ProjectLite[];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p => p.name.toLowerCase().includes(q));
  }, [projects, search]);

  const handleToggleBoards = (boardIds: string[], on: boolean): void => {
    const next = new Set(selectedBoardIds);
    for (const id of boardIds) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange([...next]);
  };

  const handleToggleExpand = (projectId: string): void => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const count = selectedBoardIds.length;
  const trigger = (
    <Button
      variant='outline'
      size='sm'
      data-slot='view-board-picker-trigger'
      data-track-category='Projects'
      data-track-name='OpenBoardPicker'
      className={cn('rounded-[10px] border-border hover:bg-muted', className)}
    >
      <Layers className='w-3 h-3 text-muted-foreground' />
      <span className='font-medium'>
        {count === 0 ? 'Select boards' : `${count} board${count > 1 ? 's' : ''}`}
      </span>
    </Button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      align='start'
      className='p-0 w-72'
    >
      <div className='flex flex-col' data-slot='view-board-picker'>
        <div className='flex items-center gap-2 px-3 py-2 border-b border-border'>
          <Search className='size-3.5 text-muted-foreground shrink-0' />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder='Search projects...'
            className='flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground'
            data-track-category='Projects'
            data-track-name='SearchBoardPicker'
          />
        </div>
        <div className='max-h-80 overflow-y-auto p-1'>
          {filteredProjects.length === 0 ? (
            <div className='px-2 py-6 text-center text-[12px] text-muted-foreground'>
              {search ? 'No matching projects' : 'No projects found'}
            </div>
          ) : (
            filteredProjects.map(project => (
              <PickerProjectRow
                key={project.id}
                project={project}
                selected={selected}
                expanded={expandedProjects.has(project.id)}
                onToggleExpand={() => handleToggleExpand(project.id)}
                onToggleBoards={handleToggleBoards}
              />
            ))
          )}
        </div>
      </div>
    </Popover>
  );
}

export default ViewBoardPicker;
