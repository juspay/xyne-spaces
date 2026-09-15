import { ReactElement } from 'react';
import { ProjectWithBoards } from './ProjectSidebar.types';
import SidebarItem from './SidebarItem';
import { highlightText } from './highlightText';

/**
 * ProjectItem - Displays an expandable project with nested boards
 */
const ProjectItem = ({
  project,
  isExpanded,
  isActive,
  activeBoardId,
  onToggle,
  onBoardClick,
  searchQuery = '',
}: {
  project: ProjectWithBoards;
  isExpanded: boolean;
  isActive: boolean;
  activeBoardId?: string | undefined;
  onToggle: () => void;
  onBoardClick: (boardId: string) => void;
  searchQuery?: string;
}): ReactElement => {
  return (
    <div
      className='mb-1'
      data-testid={`project-item-${project.id}`}
      data-project-name={project.name}
    >
      <SidebarItem
        label={project.name}
        onClick={onToggle}
        isExpandable={true}
        isExpanded={isExpanded}
        isActive={isActive}
        data-track-category='Projects'
        data-track-name='ToggleProjectExpand'
        data-track-metadata={JSON.stringify({ projectId: project.id, projectName: project.name })}
      />

      {/* Nested Boards */}
      {isExpanded && project.boards && project.boards.length > 0 && (
        <div className='ml-6 mt-1' data-testid={`project-boards-${project.id}`}>
          {project.boards.map(board => (
            <SidebarItem
              key={board.id}
              label={highlightText(board.name, searchQuery)}
              variant='nested'
              isActive={activeBoardId === board.id}
              onClick={() => onBoardClick(board.id)}
              dataTestId={`board-item-${board.id}`}
              data-track-category='Projects'
              data-track-name='SelectBoard'
              data-track-metadata={JSON.stringify({
                boardId: board.id,
                boardName: board.name,
                projectId: project.id,
              })}
            />
          ))}
        </div>
      )}
    </div>
  );
};
export default ProjectItem;
