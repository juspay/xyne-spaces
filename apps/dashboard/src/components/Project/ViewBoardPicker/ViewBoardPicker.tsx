import { ReactElement, useMemo, useState } from 'react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import {
  GroupedSelectList,
  GroupedSelectGroup,
  GroupedSelectRow,
} from '../../ui/GroupedSelectList/GroupedSelectList';
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
    <GroupedSelectGroup
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      count={selectedInProject}
      trackCategory='Projects'
      trackName='TogglePickerProject'
      header={
        <button
          type='button'
          onClick={onToggleExpand}
          className='min-w-0 flex-1 truncate text-left text-[13px] text-foreground'
          data-track-category='Projects'
          data-track-name='TogglePickerProject'
        >
          {project.name}
        </button>
      }
    >
      {boardList.length === 0 ? (
        <div className='px-2 py-1.5 text-[12px] text-muted-foreground'>No boards</div>
      ) : (
        <>
          <GroupedSelectRow>
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={handleToggleAll}
              label='All boards'
            />
          </GroupedSelectRow>
          {boardList.map(board => (
            <GroupedSelectRow key={board.id}>
              <Checkbox
                checked={selected.has(board.id)}
                onChange={checked => onToggleBoards([board.id], checked)}
                label={board.name}
              />
            </GroupedSelectRow>
          ))}
        </>
      )}
    </GroupedSelectGroup>
  );
}

interface BoardWithProject {
  id: string;
  projectId: string;
}

export function ViewBoardPickerContent({
  selectedBoardIds,
  onChange,
}: Pick<ViewBoardPickerProps, 'selectedBoardIds' | 'onChange'>): ReactElement {
  const [search, setSearch] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(new Set());

  const [projects] = useCachedQuery(queries.getAllProjectsList());
  const selected = useMemo(() => new Set(selectedBoardIds), [selectedBoardIds]);

  // Fetch selected boards to determine which projects have boards selected
  const [selectedBoards] = useCachedQuery(queries.boardsByIds({ boardIds: selectedBoardIds }), {
    enabled: selectedBoardIds.length > 0,
  });

  // Projects that have at least one selected board
  const projectsWithSelectedBoards = useMemo(() => {
    const boards = (selectedBoards ?? []) as readonly BoardWithProject[];
    return new Set(boards.map(b => b.projectId));
  }, [selectedBoards]);

  const filteredProjects = useMemo(() => {
    const list = (projects ?? []) as readonly ProjectLite[];
    const q = search.trim().toLowerCase();
    const filtered = q ? list.filter(p => p.name.toLowerCase().includes(q)) : list;

    // Sort: projects with selected boards first, then the rest
    return [...filtered].sort((a, b) => {
      const aHasSelected = projectsWithSelectedBoards.has(a.id);
      const bHasSelected = projectsWithSelectedBoards.has(b.id);
      if (aHasSelected && !bHasSelected) return -1;
      if (!aHasSelected && bHasSelected) return 1;
      return 0;
    });
  }, [projects, search, projectsWithSelectedBoards]);

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

  return (
    <GroupedSelectList
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder='Search projects...'
      isEmpty={filteredProjects.length === 0}
      emptyLabel={search ? 'No matching projects' : 'No projects found'}
      trackCategory='Projects'
      trackName='SearchBoardPicker'
    >
      {filteredProjects.map(project => (
        <PickerProjectRow
          key={project.id}
          project={project}
          selected={selected}
          expanded={expandedProjects.has(project.id)}
          onToggleExpand={() => handleToggleExpand(project.id)}
          onToggleBoards={handleToggleBoards}
        />
      ))}
    </GroupedSelectList>
  );
}
