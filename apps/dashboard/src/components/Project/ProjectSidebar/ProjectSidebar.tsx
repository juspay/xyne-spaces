import { ReactElement, useState, useEffect } from 'react';
import { SearchDefault as Search, ChevronDown } from '@xyne/icons';
import { ProjectSidebarProps } from './ProjectSidebar.types';
import DirectorySectionHeader from '../../Chat/DirectorySectionHeader';
import SidebarItem from './SidebarItem';
import ProjectItem from './ProjectItem';
import SearchInput from './SearchInput';
import ViewsSidebarSection from './ViewsSidebarSection';
import { useSearchFilter } from '../../../hooks/useSearchFilter';
import { highlightText } from './highlightText';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { UserStatus } from '@xyne/shared';
import { usePlatform } from '../../../hooks/usePlatform';
import { cn } from '../../../utils/classNames';
import AppNavigator from '../../AppNavigator/AppNavigator';

const ProjectSidebar = ({
  projects = [],
  userGroups = [],
  persons = [],
}: ProjectSidebarProps): ReactElement => {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();

  const { projectId: activeProjectId, boardId: activeBoardId } = useParams<{
    projectId?: string;
    boardId?: string;
  }>();

  const [searchParams] = useSearchParams();
  const currentAssignee = searchParams.get('assignee');
  const currentGroup = searchParams.get('group');

  // When a board is selected via the top filter dropdown, the machine syncs it to the
  // ?board= query param. This should take priority over the URL path param (activeBoardId)
  // so that changing the board from the filter always reflects in the sidebar — including
  // when in board view (/projects/:projectId/:boardId) where the path still holds the old board.
  const boardFromFilter = searchParams.get('board');
  const effectiveBoardId = boardFromFilter ?? activeBoardId ?? undefined;

  // Section expansion states
  const [isProjectsExpanded, setIsProjectsExpanded] = useState(false);
  const [isGroupsExpanded, setIsGroupsExpanded] = useState(false);
  const [isPersonsExpanded, setIsPersonsExpanded] = useState(false);

  // Track how many persons to display (load more pagination)
  const [visiblePersonsCount, setVisiblePersonsCount] = useState(5);

  // Track which projects are expanded (using a Set for O(1) lookup)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  // Search filters for each section
  const personsSearch = useSearchFilter({
    items: persons,
    searchKeys: ['name', 'displayName'],
  });

  const projectsSearch = useSearchFilter({
    items: projects,
    searchKeys: ['name'],
    nestedSearchKeys: [
      {
        arrayKey: 'boards',
        searchKeys: ['name'], // Search by board name
      },
    ],
  });

  const groupsSearch = useSearchFilter({
    items: userGroups,
    searchKeys: ['name'],
  });

  // Auto-expand the active project so its boards are always visible in the sidebar.
  // This handles both: navigating to /projects/:projectId/:boardId via the URL, and
  // selecting a board from the top filter dropdown (which sets ?board= query param).
  useEffect(() => {
    if (activeProjectId) {
      setExpandedProjects(prev => {
        if (prev.has(activeProjectId)) return prev;
        const next = new Set(prev);
        next.add(activeProjectId);
        return next;
      });
    }
  }, [activeProjectId]);

  // Auto-expand projects when searching for boards
  useEffect(() => {
    if (projectsSearch.searchQuery.trim()) {
      const matchingProjectIds = new Set<string>();

      projects.forEach(project => {
        // Check if any board in this project matches the search query
        const hasMatchingBoard = project.boards?.some(board =>
          board.name.toLowerCase().includes(projectsSearch.searchQuery.toLowerCase()),
        );

        if (hasMatchingBoard) {
          matchingProjectIds.add(project.id);
        }
      });

      // Expand all projects that have matching boards
      if (matchingProjectIds.size > 0) {
        setExpandedProjects(matchingProjectIds);
      }
    }
  }, [projectsSearch.searchQuery, projects]);

  return (
    <div className={cn('h-full w-full flex flex-col', isMobile && 'bg-sidebar')}>
      <div className='w-full h-[52px] shrink-0'>
        <AppNavigator />
      </div>
      <div className='flex-1 min-h-0 px-3 pt-3 pb-12 sm:pb-0 flex flex-col border-t border-sidebar-border-muted'>
        {/* Header */}
        <div className='hidden sm:flex pt-2 pb-3 px-2 h-10 items-center justify-between mb-2'>
          <h2 className='text-base font-semibold leading-normal text-sidebar-accent-foreground'>
            Projects Board
          </h2>
        </div>

        {/* Scrollable Content */}
        <div className='flex-1 min-h-0 overflow-y-auto no-scrollbar px-0.5 pt-1'>
          <ViewsSidebarSection />

          {/* PROJECTS Section */}
          <div className='mb-4'>
            <div className='flex items-center gap-2'>
              {projectsSearch.isSearchOpen ? (
                <SearchInput
                  value={projectsSearch.searchQuery}
                  onChange={projectsSearch.setSearchQuery}
                  onClose={projectsSearch.closeSearch}
                  placeholder='Search projects/Boards...'
                />
              ) : (
                <>
                  <div className='flex-1'>
                    <DirectorySectionHeader
                      title='Projects'
                      isExpanded={isProjectsExpanded}
                      onToggle={() => setIsProjectsExpanded(!isProjectsExpanded)}
                    />
                  </div>
                  <button
                    onClick={projectsSearch.openSearch}
                    className='p-1 hover:bg-muted rounded transition-colors'
                    data-track-category='Projects'
                    data-track-name='OpenProjectSearch'
                  >
                    <Search className='size-3 text-muted-foreground' />
                  </button>
                </>
              )}
            </div>

            {isProjectsExpanded && (
              <div className='mt-1'>
                {projectsSearch.filteredItems.length === 0 ? (
                  <div className='px-2 py-3 text-[13px] text-muted-foreground text-center'>
                    {projectsSearch.searchQuery ? 'No matching projects' : 'No projects found'}
                  </div>
                ) : (
                  projectsSearch.filteredItems.map(project => (
                    <ProjectItem
                      key={project.id}
                      project={project}
                      isExpanded={expandedProjects.has(project.id)}
                      isActive={activeProjectId === project.id}
                      activeBoardId={effectiveBoardId}
                      searchQuery={projectsSearch.searchQuery}
                      onToggle={() => {
                        void navigate(`/projects/${project.id}`);
                        setExpandedProjects(prev => {
                          const newSet = new Set(prev);
                          if (newSet.has(project.id)) {
                            newSet.delete(project.id);
                          } else {
                            newSet.add(project.id);
                          }
                          return newSet;
                        });
                      }}
                      onBoardClick={boardId => {
                        void navigate(`/projects/${project.id}/${boardId}`);
                      }}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {/* FILTER BY GROUPS Section */}
          <div className='mb-4'>
            <div className='flex items-center gap-2'>
              {groupsSearch.isSearchOpen ? (
                <SearchInput
                  value={groupsSearch.searchQuery}
                  onChange={groupsSearch.setSearchQuery}
                  onClose={groupsSearch.closeSearch}
                  placeholder='Search groups...'
                />
              ) : (
                <>
                  <div className='flex-1'>
                    <DirectorySectionHeader
                      title='Filter by Groups'
                      isExpanded={isGroupsExpanded}
                      onToggle={() => setIsGroupsExpanded(!isGroupsExpanded)}
                    />
                  </div>
                  <button
                    onClick={groupsSearch.openSearch}
                    className='p-1 hover:bg-muted rounded transition-colors'
                    data-track-category='Projects'
                    data-track-name='OpenGroupSearch'
                  >
                    <Search className='size-3 text-muted-foreground' />
                  </button>
                </>
              )}
            </div>

            {isGroupsExpanded && (
              <div className='mt-1'>
                {groupsSearch.filteredItems.length === 0 ? (
                  <div className='px-2 py-3 text-[13px] text-muted-foreground text-center'>
                    {groupsSearch.searchQuery ? 'No matching groups' : 'No groups found'}
                  </div>
                ) : (
                  groupsSearch.filteredItems.map(group => (
                    <SidebarItem
                      key={group.id}
                      label={highlightText(group.name, groupsSearch.searchQuery)}
                      isActive={currentGroup === group.id}
                      onClick={() => {
                        void navigate(`/projects?group=${group.id}`);
                      }}
                      data-track-category='Projects'
                      data-track-name='SelectGroupFilter'
                      data-track-metadata={JSON.stringify({
                        groupId: group.id,
                        groupName: group.name,
                      })}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {/* FILTER BY PERSONS Section */}
          <div className='mb-4'>
            <div className='flex items-center gap-2'>
              {personsSearch.isSearchOpen ? (
                <SearchInput
                  value={personsSearch.searchQuery}
                  onChange={personsSearch.setSearchQuery}
                  onClose={personsSearch.closeSearch}
                  placeholder='Search persons...'
                />
              ) : (
                <>
                  <div className='flex-1'>
                    <DirectorySectionHeader
                      title='Filter by Persons'
                      isExpanded={isPersonsExpanded}
                      onToggle={() => setIsPersonsExpanded(!isPersonsExpanded)}
                    />
                  </div>
                  <button
                    onClick={personsSearch.openSearch}
                    className='p-1 hover:bg-muted rounded transition-colors'
                    data-track-category='Projects'
                    data-track-name='OpenPersonSearch'
                  >
                    <Search className='size-3 text-muted-foreground' />
                  </button>
                </>
              )}
            </div>

            {isPersonsExpanded && (
              <div className='mt-1'>
                {personsSearch.filteredItems.length === 0 ? (
                  <div className='px-2 py-3 text-[13px] text-muted-foreground text-center'>
                    {personsSearch.searchQuery ? 'No matching persons' : 'No persons found'}
                  </div>
                ) : (
                  <>
                    {personsSearch.filteredItems.slice(0, visiblePersonsCount).map(person => {
                      const displayName = getUserDisplayName(person);
                      const isDeactivated =
                        'status' in person && person.status === UserStatus.INACTIVE;
                      return (
                        <SidebarItem
                          key={person.id}
                          label={
                            <div className='flex items-center gap-1.5'>
                              <span className={isDeactivated ? 'text-muted-foreground' : ''}>
                                {highlightText(displayName, personsSearch.searchQuery)}
                              </span>
                              {isDeactivated && (
                                <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
                                  Deactivated
                                </span>
                              )}
                            </div>
                          }
                          isActive={currentAssignee === person.id}
                          avatar={{
                            url: person.picture ?? null,
                            fallbackText: displayName.charAt(0).toUpperCase(),
                          }}
                          onClick={() => {
                            void navigate(`/projects?assignee=${person.id}`);
                          }}
                          data-track-category='Projects'
                          data-track-name='SelectPersonFilter'
                          data-track-metadata={JSON.stringify({
                            personId: person.id,
                            personName: displayName,
                          })}
                        />
                      );
                    })}
                    {/* Show more button */}
                    {personsSearch.filteredItems.length > visiblePersonsCount && (
                      <button
                        onClick={() => setVisiblePersonsCount(prev => prev + 5)}
                        className='w-full flex items-center gap-2 px-3 py-1.5 rounded-[10px] transition-colors hover:bg-sidebar-accent group'
                        data-track-category='Projects'
                        data-track-name='ShowMorePersons'
                      >
                        <ChevronDown className='size-2 text-muted-foreground group-hover:text-muted-foreground' />
                        <span className='text-[10px] text-muted-foreground group-hover:text-muted-foreground'>
                          Show more ({personsSearch.filteredItems.length - visiblePersonsCount})
                        </span>
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectSidebar;
