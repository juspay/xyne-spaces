import { ProjectWithBoards } from './ProjectSidebar.types';

/**
 * Sort projects by creation date (newest first)
 */
export const sortProjectsByDate = (projects: ProjectWithBoards[]): ProjectWithBoards[] => {
  return [...projects].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
};

/**
 * Filter projects by search term
 */
export const filterProjectsBySearch = (
  projects: ProjectWithBoards[],
  searchTerm: string,
): ProjectWithBoards[] => {
  if (!searchTerm.trim()) return projects;

  const term = searchTerm.toLowerCase();
  return projects.filter(project => {
    const matchesProject = project.name.toLowerCase().includes(term);
    const matchesBoards = project.boards?.some(board => board.name.toLowerCase().includes(term));
    return matchesProject || matchesBoards;
  });
};

/**
 * Get total board count across all projects
 */
export const getTotalBoardCount = (projects: ProjectWithBoards[]): number => {
  return projects.reduce((total, project) => {
    return total + (project.boards?.length || 0);
  }, 0);
};
