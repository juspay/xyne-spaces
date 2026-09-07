import type { PartialBlock } from '@blocknote/core';
import { CanvasVisibility, CanvasRole, DocType, ChannelScopeType } from '@xyne/shared';
import type { CanvasMarkdownExportResult, CanvasPdfExportResult } from '../../utils/canvasExport';

export interface CanvasEditorRef {
  handlePresent: () => void;
  handleThemeChange: (themeOrEvent: string | React.ChangeEvent<HTMLSelectElement>) => void;
  getBlocks: () => PartialBlock[];
  replaceContent: (blocks: PartialBlock[]) => void;
  exportMarkdown: (title: string) => Promise<CanvasMarkdownExportResult>;
  exportPDF: (title: string) => Promise<CanvasPdfExportResult>;
  toggleComments: () => void;
  selectedTheme: string;
}

export interface CanvasEditorProps {
  content?: PartialBlock[] | undefined;
  onChange?: (blocks: PartialBlock[], html?: string) => void;
  onSave?: (blocks: PartialBlock[], html?: string) => void;
  onFileUpload?: (file: File) => Promise<string>;
  editable?: boolean;
  placeholder?: string;
  className?: string;
  /** When set, @ mention list is scoped to this channel/DM's participants only */
  channelId?: string | undefined;
  /** Canvas ID for mention notifications (event-based) */
  canvasId?: string | undefined;
  /** Canvas title for mention notifications */
  canvasTitle?: string | undefined;
  /** Called when a user/group is selected from @ menu - used for event-based mention notifications */
  onMentionInsert?: (params: { type: 'user' | 'group'; id: string; blockId: string }) => void;
  /** When set, focus and scroll to this block on load (e.g. from activity notification) */
  initialBlockIdToFocus?: string | undefined;
  /** When set with initialBlockIdToFocus, open the matching comment thread on load. */
  initialCommentThreadId?: string | undefined;
  /** Emits the number of open comment threads already loaded by the editor highlight query. */
  onOpenCommentCountChange?: (count: number) => void;
  /** Auto-focus the editor on mount */
  autoFocus?: boolean;
  /** Optional preloaded canvas participants to avoid duplicate query */
  canvasParticipants?: CanvasParticipant[] | undefined;
  /** Optional preloaded canvas creator */
  canvasCreatedBy?: string | undefined;
  /** Effective role of current user on this canvas */
  currentUserRole?: CanvasRole | null;
}

export interface CollaborativeCanvasEditorRef {
  handlePresent: () => void;
  handleThemeChange: (themeOrEvent: string | React.ChangeEvent<HTMLSelectElement>) => void;
  getBlocks: () => PartialBlock[];
  replaceContent: (blocks: PartialBlock[]) => void;
  /** Place the caret in a block (used after client-applied suggestion accepts). */
  setTextCursorPosition?: (blockId: string, placement?: 'start' | 'end') => void;
  exportMarkdown: (title: string) => Promise<CanvasMarkdownExportResult>;
  exportPDF: (title: string) => Promise<CanvasPdfExportResult>;
  toggleComments: () => void;
  selectedTheme: string;
}

/**
 * Metadata for knowledge canvases (created from workflow learnings)
 */
export interface KnowledgeCanvasMetadata {
  source: 'workflow_knowledge';
  workflowExecutionId: string;
  learningCount: number;
  projectId?: string;
  conversationId?: string;
  repositoryUrl?: string | null;
  learningIds?: string[];
  // Approval tracking
  approvedAt?: string;
  approvedBy?: string;
  knowledgeDocumentId?: string;
}

export interface CanvasProject {
  id: string;
  name: string;
  code?: string;
}

export interface CanvasChannel {
  id: string;
  name: string;
  projectId: string;
  isArchived?: boolean;
  scopeType?: ChannelScopeType;
}

export interface CanvasFolder {
  id: string;
  name: string;
  projectId?: string | null;
  channelId?: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  project?: CanvasProject | null;
  channel?: CanvasChannel | null;
}

export interface Canvas {
  id: string;
  title: string;
  content?: PartialBlock[];
  channelId?: string;
  folderId?: string | null;
  projectId?: string | null;
  createdBy: string;
  visibility: CanvasVisibility;
  isTemplate: boolean;
  isArchived?: boolean;
  isCollaborative?: boolean;
  isStarred?: boolean;
  lastEditedBy?: string;
  lastEditedAt?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown> | KnowledgeCanvasMetadata;
  sdlcArtifact?: { artifactType?: string; artifactStatus?: string } | null;
  accessLevel?: CanvasRole;
  docType?: DocType;
  folder?: CanvasFolder | null;
  channel?: CanvasChannel | null;
  project?: CanvasProject | null;
  userStatuses?: CanvasUserStatus[];
}

export interface CanvasUserStatus {
  id: string;
  canvasId: string;
  userId: string;
  isStarred: boolean;
  createdAt: number;
  updatedAt?: number;
}

export interface CanvasParticipant {
  id: string;
  canvasId: string;
  userId?: string | null;
  userGroupId?: string | null;
  channelId?: string | null;
  role: CanvasRole;
  joinedAt: number;
  updatedAt: number;
}

export interface CanvasListProps {
  onSelect: (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => void;
  onDelete?: (canvasId: string) => void;
  onDuplicate?: (canvasId: string, canvas?: Canvas) => void;
  onArchiveToggle?: (canvas: Canvas) => void;
  currentUserId?: string | undefined;
  activeFilter?: 'all' | 'created_by_me' | 'shared';
  onFilterChange?: (filter: 'all' | 'created_by_me' | 'shared') => void;
  selectedCanvasId?: string;
  paginated?: boolean;
  channelId?: string;
  excludeCallGeneratedCanvases?: boolean;
  excludeRecordingGeneratedCanvases?: boolean;
  onlyCallGeneratedCanvases?: boolean;
  onlyRecordingGeneratedCanvases?: boolean;
  showStarredOnly?: boolean;
  includeArchived?: boolean;
  onlyArchived?: boolean;
  onToggleStar?: (canvas: Canvas) => void;
}
