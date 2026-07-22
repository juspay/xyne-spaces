import type { Board, Project } from '@xyne/shared';

// Extended type: Project with its boards included
export type ProjectWithBoards = Project & {
  boards?: readonly Board[];
};

// Extended type: Board with its stages included
// Favorite item - can be a ticket view or a board
// User group for filtering
export type UserGroup = {
  id: string;
  name: string;
  alias?: string | null;
  description?: string | null;
  memberCount?: number;
};

// Person for filtering
export type Person = {
  id: string;
  name: string;
  email: string;
  picture?: string | null;
  displayName?: string | null;
};

// Props for the ProjectSidebar component
export interface ProjectSidebarProps {
  projects?: readonly ProjectWithBoards[];
  userGroups?: readonly UserGroup[];
  persons?: readonly Person[];
}
