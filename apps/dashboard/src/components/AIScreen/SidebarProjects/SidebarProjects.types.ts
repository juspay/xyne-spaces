import type { ReactNode } from 'react';
import type { ChatProject } from '../../../services/XyneAI/XyneAISessionsV2Service';
import type { ConversationHistory as ConversationHistoryType } from '../../Chat/XyneAISidebar/utils/XyneAITypes';

export type RenderSessions = (sessions: ConversationHistoryType[]) => ReactNode;

export interface SidebarProjectsProps {
  agentFilter: string | null;
  renderSessions: RenderSessions;
  userId?: string | undefined;
  onCreateChatInProject: (projectId: string) => void;
}

export interface ProjectRowProps {
  project: ChatProject;
  isExpanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNewChat: () => void;
}

export interface ProjectChatsProps {
  projectId: string;
  agentFilter: string | null;
  isExpanded: boolean;
  renderSessions: RenderSessions;
}

export type ProjectDialogKind = 'create' | 'rename' | 'delete';

export interface ProjectDialogsProps {
  kind: ProjectDialogKind | null;
  project: ChatProject | null;
  onClose: () => void;
}
