/**
 * @xyne/workflow-sdk/client — typed HTTP client for the workflow router.
 *
 * Usage:
 * ```ts
 * import { createWorkflowClient } from '@xyne/workflow-sdk/client';
 *
 * const client = createWorkflowClient({
 *   baseUrl: '/api/workflows',
 *   getHeaders: () => ({ Authorization: `Bearer ${token}` }),
 * });
 *
 * const steps = await client.schema.steps();
 * const result = await client.workflows.validate(config);
 * ```
 */

export { createWorkflowClient, WorkflowClientError } from './workflow-client.js';

// Live change notifications — one multiplexed SSE connection per client.
export type {
  EventsClient,
  EventSubscription,
  EventStreamHandlers,
} from './events-client.js';
export type { SSEFrame } from './sse.js';
export type { ConversationStreamEvent } from '../conversational-flow/turn.js';
export type { Transcript, TranscriptEntry, Turn, TurnAnswer, TurnEvent, TurnMessage, TurnOption, TurnReply, TurnScreen, TurnStatus } from '../conversational-flow/turn.js';

// The opaque reference `uploads.create()` returns and `uploads.url()` takes.
export type { Attachment } from '../common/index.js';

export type {
  // Client config
  WorkflowClientConfig,
  // Client interfaces
  WorkflowClient,
  SchemaClient,
  WorkflowsCrudClient,
  FoldersClient,
  ConversationsClient,
  AdvanceConversation,
  ExecutionsClient,
  CredentialsClient,
  UploadsClient,
  AnalyticsClient,
  AnalyticsSummaryResult,
  ApprovalAnalyticsResult,
  TopError,
  // Input types
  CreateWorkflowInput,
  UpdateWorkflowInput,
  CreateFolderInput,
  UpdateFolderInput,
  ResumeInput,
  RerunInput,
  CreateCredentialInput,
  ReplaceCredentialValuesInput,
  CredentialSummary,
  CredentialListItem,
  CredentialListResponse,
  ExecutionListParams,
  // Response types
  ExecutionDetail,
  StepEvent,
  PaginatedList,
  WorkflowCounts,
  PendingApprovalSummary,
  PendingApprovalParams,
  PendingApprovalCountParams,
  PendingApprovalFacets,
  LastRun,
  RequestOpts,
  // Re-exported from persistence
  PendingApprovalBucket,
  WorkflowRecord,
  FolderRecord,
  ExecutionRecord,
  StepRecord,
} from './types.js';
