/**
 * @xyne/spaces-sdk
 *
 * TypeScript SDK for the Xyne Spaces API.
 *
 * @example
 * ```typescript
 * import { createClient } from '@xyne/spaces-sdk';
 *
 * const sdk = createClient({
 *   apiKey: process.env.XYNE_SPACES_API_KEY,
 * });
 *
 * // List users
 * const users = await sdk.users.list();
 *
 * // Search
 * const results = await sdk.search.query({ q: 'project update' });
 * ```
 *
 * @packageDocumentation
 */

// ----- Client -----
export { createClient, SpacesClient } from './client.js';
export type { SpacesClientOptions } from './client.js';

// ----- Claw (remote agents, relayed through Spaces) -----
export { ClawResource } from './resources/claw.js';
export type { ClawRunAndWaitInput } from './resources/claw.js';

// ----- Error Types -----
export {
  SdkError,
  AuthError,
  NotFoundError,
  RateLimitError,
  ZeroOperationError,
} from './core/errors.js';
export type { SdkErrorCode } from './core/errors.js';

// ----- Model Types -----
export type {
  // Enums
  MessageType,
  ChannelRole,
  ChannelSortOrder,
  ChannelScopeType,
  ChannelVisibility,
  ChannelType,
  DeskType,
  // Users
  CurrentUser,
  User,
  UserProfile,
  UserPresence,
  // Channels
  Channel,
  ChannelParticipant,
  ChannelUserStatus,
  ChannelSection,
  CreateChannelInput,
  CheckDuplicateChannelResponse,
  // Messages
  Message,
  MessageAttachment,
  UploadFileInput,
  UploadedAttachment,
  AttachmentUploadResponse,
  DraftAttachmentUploadResult,
  DraftAttachmentUploadResponse,
  Reaction,
  // Conversations
  Conversation,
  ConversationParticipant,
  CreateConversationWithAttachmentsInput,
  // Activities
  Activity,
  // Tickets
  Ticket,
  SubTicket,
  TicketPriority,
  TicketStatusV2,
  TicketStageRequest,
  CreateTicketInput,
  CreateTicketResponse,
  StageRequestStatus,
  // Boards & projects
  Board,
  Stage,
  Project,
  // Flow boards
  FlowPlan,
  FlowPlanNode,
  FlowPlanGroup,
  FlowPlanDecision,
  FlowDecisionRoute,
  FlowStepGate,
  // Canvases
  Canvas,
  CanvasFolder,
  CanvasParticipant,
  CanvasComment,
  CanvasCommentThread,
  CanvasVersion,
  CanvasVisibility,
  CanvasRole,
  CanvasCommentThreadStatus,
  // Collections
  Collection,
  CollectionItem,
  // Forms
  Form,
  FormField,
  FormEntityValue,
  // Calls
  Call,
  CallParticipant,
  CallStatus,
  // Email
  EmailDraft,
  EmailSignature,
  EmailChannelPreference,
  ConversationLabel,
  // Recaps
  Recap,
  // Search
  SearchResult,
  SearchResponse,
  SearchOptions,
  // Claw
  ClawAgent,
  ClawRun,
  ClawRunInput,
  // Pagination
  PaginatedResponse,
  PaginationOptions,
} from './types/index.js';

// ----- Pagination Cursors -----
export type { ConversationCursor } from './registry/conversations.js';
export type { MessageCursor } from './registry/messages.js';
export type { ActivityCursor } from './registry/activities.js';
export type {
  TicketCursor,
  TicketActivityCursor,
  TicketViewMode,
  KanbanColumnType,
  KanbanTicketFilters,
} from './registry/tickets.js';
export type { SupportTicketCursor } from './registry/support-tickets.js';
export type { StageInput } from './registry/boards.js';
export type { CanvasCursor, CanvasScope } from './registry/canvases.js';
export type { FormFieldInput } from './registry/forms.js';
export type { CallCursor } from './registry/calls.js';
export type { EmailCursor, EmailDraftCursor } from './registry/email.js';
export type { AppCursor, RoleCursor } from './registry/admin.js';
export type { WorkflowCursor } from './registry/automations.js';
export type { RcaCursor } from './registry/incidents.js';
export type {
  UploadAttachmentsInput,
  UploadDraftAttachmentsInput,
} from './registry/attachments.js';

// ----- Registry Types (for advanced usage) -----
export type {
  Operation,
  QueryOperation,
  MutatorOperation,
  ApiOperation,
  OperationType,
  HttpMethod,
} from './registry/types.js';
export { query, mutator, api } from './registry/types.js';
