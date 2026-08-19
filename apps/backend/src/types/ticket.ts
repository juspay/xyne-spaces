import { TicketStatusV2, TicketPriority } from '@xyne/shared';
import { BulkTicketMode } from '@xyne/shared';

export interface CreateTicketRequest {
  /** Internal idempotency hook (used by FLOW materialization). */
  id?: string;
  // Required fields
  title: string;
  description: string;
  projectId: string; // Project to which the ticket is linked
  workspaceId: string; // Workspace for ACL optimization (denormalized from project)
  userGroupId?: string; // User group to which the ticket belongs
  boardId: string; // Board to which the ticket belongs (required)

  // Conversation/Channel (at least one required)
  conversationId?: string; // Existing conversation (if creating from chat)
  channelId?: string; // Channel to create conversation in (if creating from form)

  // Optional fields with defaults in DB
  statusV2?: TicketStatusV2; // Default: TODO
  priority?: TicketPriority; // Default: LOW

  // Optional fields
  assignedTo?: string;
  eta?: Date;
  createdAt?: string; // Optional createdAt for backdated tickets
  metadata?: Record<string, unknown>; // Additional metadata - external source tracking, domain-specific context
  rootId?: string; // FLOW root ticket id for this materialized step ticket.
  closedAt?: Date;
  closedBy?: string;
  sourceConversationId?: string;
  excludedChatAttachmentIds?: string[]; // IDs of chat attachments to exclude when creating from conversation
  draftAttachmentIds?: string[]; // IDs of draft attachments to transfer to ticket when creating from conversation
  dynamicFields?: Record<string, string>; // Dynamic form field values for the ticket
  workflowType?: string; // Optional workflow type for automation
  stageName?: string; // Optional stage name for the ticket
  skipStageEta?: boolean; // Skip creating active stage ETA tracking entry
  tags?: string[]; // Optional tags for categorization
  merchantId?: string; // Merchant ID to which the ticket is linked
  ticketType?: string; // Lookup value from lookup_values table (type=TICKET_TYPE)

}

export interface GetTicketDetailsResponse {
  id: string;
  title: string;
  description: string;
  status: TicketStatusV2;
  createdBy: string;
  updatedBy: string;
  assignedTo?: string | null;
  conversationId: string;
  eta?: Date | null;
  priority: TicketPriority;
  metadata?: Record<string, unknown> | null;
  closedAt?: Date | null;
  closedBy?: string | null;
  xyneId: string;
  projectId: string;
  boardId: string;
  stageName: string;
  ticketType?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketDuplicateCheckRequest {
  title: string;
  description: string;
  projectId: string;
  limit?: number;
}

export interface TicketDuplicateCandidate {
  id: string;
  title: string;
  description: string;
  boardId?: string;
  status?: string;
  stage?: string;
  relevanceScore?: number;
  channelId?: string;
  conversationId?: string;
  createdAt?: string;
}

export interface TicketDuplicateCheckAnalysis {
  isDuplicate: boolean;
  duplicateTicketId?: string | null;
  confidence?: number;
  reason?: string;
  error?: string;
}

export interface TicketDuplicateCheckResponse {
  candidates: TicketDuplicateCandidate[];
  analysis: TicketDuplicateCheckAnalysis;
}

/**
 * Source/origin of ticket stage updates
 * Used to determine activity creation behavior and provide audit trail
 */
export enum ActivitySource {
  INTERNAL = 'INTERNAL', // Internal/manual updates - creates STAGE_NAME activity
  WEBHOOK = 'WEBHOOK', // External PR webhook events - skips STAGE_NAME activity (handled separately)
  AUTOMATION = 'AUTOMATION', // Automation engine steps — shows "Automation" in activity feed
}

/**
 * Board suggestion types for AI-powered board detection
 */

export interface TicketBoardCandidate {
  id: string;
  name: string;
  description?: string;
  boardType?: string;
  stageCount?: number;
}

export interface TicketBoardAnalysis {
  suggestedBoardId: string | null;
  suggestedBoardName: string | null;
  error?: string;
}

export interface TicketBoardSuggestionRequest {
  title: string;
  description: string;
  projectId: string;
}

export interface TicketBoardSuggestionResponse {
  candidates: TicketBoardCandidate[];
  analysis: TicketBoardAnalysis;
}

export interface BulkSubTicketInput {
  title: string;
  description?: string;
  priority?: TicketPriority;
  statusV2?: TicketStatusV2;
  eta?: Date;
  channelId: string;
  boardId?: string;
  assignedTo?: string;
  userGroupId?: string;
  tags?: string[];
  ticketType?: string;
  stageName?: string;
  dynamicFields?: Record<string, string>;
  merchantId?: string;
  workflowType?: string;
  clientRowId?: string;
}

export interface CreateBulkTicketRequest {
  mode?: BulkTicketMode;
  existingParentTicketId?: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  parent?: {
    title: string;
    description: string;
    projectId: string;
    boardId: string;
    channelId: string;
    priority?: TicketPriority;
    statusV2?: TicketStatusV2;
    eta?: Date;
    assignedTo?: string;
    userGroupId?: string;
    tags?: string[];
    ticketType?: string;
    stageName?: string;
    dynamicFields?: Record<string, string>;
    merchantId?: string;
    workflowType?: string;
    sourceConversationId?: string;
    excludedChatAttachmentIds?: string[];
    draftAttachmentIds?: string[];
  };
  subTickets?: BulkSubTicketInput[];
  tickets?: BulkTicketInput[];
  projectId?: string;
  channelId?: string;
  boardId?: string;
}

export interface BulkTicketCreationFailure {
  clientRowId: string;
  title: string;
  error?: string;
}

export interface CreateBulkTicketResponse {
  parentTicketId?: string;
  parentXyneId?: string;
  conversationId?: string;
  enqueuedSubTickets: number;
  failedSubTickets?: number;
  failedTitles?: string[];
  failures?: BulkTicketCreationFailure[];
  createdTicketIds?: string[];
}

export interface BulkTicketInput {
  title: string;
  description?: string;
  projectId?: string;
  boardId?: string;
  channelId?: string;
  priority?: TicketPriority;
  statusV2?: TicketStatusV2;
  eta?: Date;
  assignedTo?: string;
  userGroupId?: string;
  tags?: string[];
  ticketType?: string;
  stageName?: string;
  dynamicFields?: Record<string, string>;
  merchantId?: string;
  workflowType?: string;
  clientRowId?: string;
}
