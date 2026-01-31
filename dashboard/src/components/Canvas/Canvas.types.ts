import type { PartialBlock } from '@blocknote/core';
import { CanvasVisibility, CanvasRole, DocType } from '@xyne/shared';

export interface CanvasEditorRef {
  handlePresent: () => void;
  handleThemeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
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
}

export interface CollaborativeCanvasEditorRef {
  handlePresent: () => void;
  handleThemeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
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

export interface Canvas {
  id: string;
  title: string;
  content?: PartialBlock[];
  channelId?: string;
  createdBy: string;
  visibility: CanvasVisibility;
  isTemplate: boolean;
  isCollaborative?: boolean;
  lastEditedBy?: string;
  lastEditedAt?: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown> | KnowledgeCanvasMetadata;
  viewAccessId?: string;
  editAccessId?: string;
  accessLevel?: CanvasRole;
  docType?: DocType;
  userRepo?: string;
  repoId?: string;
  branchName?: string;
  entryFile?: string;
  quartoDocumentType?: string;
  gcsPath?: string;
}

export interface CanvasParticipant {
  id: string;
  canvasId: string;
  userId: string;
  role: CanvasRole;
  joinedAt: number;
  updatedAt: number;
}

export interface CanvasListProps {
  canvases: Canvas[];
  onSelect: (canvas: Canvas) => void;
  onDelete?: (canvasId: string) => void;
  onDuplicate?: (canvasId: string) => void;
  loading?: boolean;
  currentUserId?: string | undefined;
  // XYNE-1287: Quarto docs support
  quartoDocs?: Canvas[];
  showQuartoDocsFilter?: boolean;
  activeFilter?: 'all' | 'created_by_me' | 'quarto_docs';
  onFilterChange?: (filter: 'all' | 'created_by_me' | 'quarto_docs') => void;
  onCreateQuartoDoc?: () => void;
}

export interface CanvasHeaderProps {
  canvas?: Canvas;
  onTitleChange?: (title: string) => void;
  onSave?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  isOwner?: boolean;
  saving?: boolean;
}
