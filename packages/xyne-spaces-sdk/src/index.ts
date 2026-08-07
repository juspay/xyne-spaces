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
 *   token: process.env.XYNE_SPACES_TOKEN,
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
  // Users
  User,
  UserProfile,
  UserPresence,
  // Channels
  Channel,
  ChannelParticipant,
  ChannelUserStatus,
  ChannelSection,
  // Messages
  Message,
  MessageAttachment,
  Reaction,
  // Conversations
  Conversation,
  ConversationParticipant,
  // Activities
  Activity,
  // Tickets
  Ticket,
  SubTicket,
  TicketPriority,
  TicketStatusV2,
  TicketStageRequest,
  StageRequestStatus,
  // Boards & projects
  Board,
  Stage,
  Project,
  // Search
  SearchResult,
  SearchResponse,
  SearchOptions,
  // Pagination
  PaginatedResponse,
  PaginationOptions,
} from './types/index.js';

// ----- Pagination Cursors -----
export type { ConversationCursor } from './registry/conversations.js';
export type { MessageCursor } from './registry/messages.js';
export type { ActivityCursor } from './registry/activities.js';
export type { TicketCursor, TicketViewMode } from './registry/tickets.js';
export type { SupportTicketCursor } from './registry/support-tickets.js';
export type { StageInput } from './registry/boards.js';

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
