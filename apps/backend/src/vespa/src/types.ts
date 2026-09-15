import { TicketPriority, TicketStatusV2, UserStatus } from "@xyne/shared";

export const ticketSchema = 'ticket';
export const messageSchema = 'chat_message';
export const attachmentSchema = 'chat_attachment';
export const channelSchema = 'chat_container';
export const projectSchema = 'project';
export const userSchema = 'user';
export const fileSchema = 'file'
export const memorySchema = 'memory';
export const samTranscriptSchema = 'sam_transcript';
export const mailSchema = 'mail';
export const appSchema = 'app';
export const callSchema = 'call';
export type VespaSchema =
  | typeof ticketSchema
  | typeof messageSchema
  | typeof attachmentSchema
  | typeof channelSchema
  | typeof userSchema
  | typeof projectSchema
  | typeof fileSchema
  | typeof memorySchema
  | typeof samTranscriptSchema
  | typeof mailSchema
  | typeof appSchema
  | typeof callSchema

export const VESPA_SCHEMAS: VespaSchema[] = [
  ticketSchema,
  messageSchema,
  attachmentSchema,
  channelSchema,
  projectSchema,
  userSchema,
  fileSchema,
  memorySchema,
  samTranscriptSchema,
  mailSchema,
  appSchema,
  callSchema
];

export const MemoryScope = {
  MY: 'my',
  ALL: 'all',
} as const;

export type MemoryScope = (typeof MemoryScope)[keyof typeof MemoryScope];

export interface Chapter {
  timestamp: string;
  topic: string;
  content: string;
}

export interface ActionItem {
  timestamp: string;
  assignee: string;
  content: string;
  deadLine?: string;
}

export interface QnA {
  timestamp: string;
  questioner: string;
  answerer: string;
  question: string;
  answer: string;
}

export interface OtherItem {
  content: string;
  speaker: string;
  tags: string[];
}

export interface AIAnalysis {
  summary: string;
  chapters: Chapter[];
  action_items: ActionItem[];
  q_n_a: QnA[];
  others?: OtherItem[];
}

export interface SamTranscriptInput {
  meetCode: string;
  participants: string[];
  platform: string;
  type: string;
  duration: string;
  aiAnalysedData: AIAnalysis;
  dateTime: string;
  merchants: string[];
}

// Deprecated: Use VESPA_SCHEMAS instead

export enum VespaDocType {
  TICKET = 'ticket',
  MESSAGE = 'message',
  ATTACHMENT = 'attachment',
  CHANNEL = 'channel',
  PROJECT = 'project',
  USER = 'user',
  FILE = 'file',
  MEMORY = 'memory',
  FACT = 'fact',
  SOP = 'sop',
  SAM_TRANSCRIPT = 'sam_transcript',
  MAIL = 'mail',
  APP = 'app',
  CALL = 'call'
}

export enum SubApp {
  RCA = "RCA",
  CANVAS = "CANVAS",
  TRANSCRIPT = "TRANSCRIPT",
  COLLECTIONS = "COLLECTIONS",
  CHAT_ATTACHMENT = "CHAT_ATTACHMENT",
  TICKET_ATTACHMENT = "TICKET_ATTACHMENT",
}

export interface VespaDocument {
  docId: string;
  docType: VespaDocType;
  orgId?: string;
  workspaceId?: string;
}

export interface importedTicketFields {
  channelId: string;
  projectId: string;
}

export interface importedMailFields {
  channelId: string;
  channelName: string;
}

export interface importedChannelFields {
  isIm: boolean;
  isMpim: boolean;
  channelName: string;
  channelId: string;
  permissions: string[];
}

export type TicketFormField = {
  fieldId: string;
  fieldValue: string;
  fieldValueLong?: number;
};

export type TicketFormFields = TicketFormField[];

export type VespaTicketFormField = TicketFormField;

export enum RankProfile {
  nativeRank = "default_native",
  unifiedRank = 'unified',
  personalizedRank = 'personalized',
  fuzzyRank = 'default_fuzzy',
  duplicateDetection = 'duplicate_detection'
}

export type User = {
  id: string,
  name: string,
  email: string
}

export type Channel = {
  id: string,
  name: string
}

export interface VespaChatAttachmentDocument extends VespaDocument {
  messageId: string;
  filename: string;
  mimeType: string;
  fileType: string;
  size: number;
  channelRef: string;
  url: string;
  urlPrivate: string;
  urlPrivateDownload: string;
  thumbnailUrl: string;
  createdAt: number;
  userId: string;
  dimensions: [number, number];
  duration: number;
  metadata: string;
  chunks: string[];
}

export interface VespaChatContainerDocument extends VespaDocument {
  channelName: string;
  scopeType: string;
  visibility: string;
  isIm: boolean;
  isMpim: boolean;
  permissions: string[];
  isPrivate: boolean;
  createdBy: string;
  ownerId: string;
  projectId: string;
  metadata: string;
  lastActivityAt: number;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number;
  topic: string;
  description: string;
  isArchived: boolean;
  memberCount: number;
}

export interface VespaChatMessageDocument extends Omit<VespaDocument, 'orgId' | 'workspaceId'> {
  text: string;
  chunks: string[];
  links?: string[];
  hasLinks: boolean;
  userId: string;
  username: string;
  userEmail: string;
  image: string;
  createdAt: string;
  createdAtTimestamp: number;
  threadId: string;
  isRootMessage?: boolean;
  /** What this message does — DECISION, COMMITMENT, ... Mirrors messages.messageActs. */
  messageActs?: string[];
  /** What kind of thread this is. Set only on the thread's root message. */
  threadType?: string[];
  channelWeightedSet: any,
  userWeightedSet: any,
  channelRef: string;
  attachmentIds: string[];
  reactions: number;
  replyCount: number;
  replyUsersCount: number;
  mentions: string[];
  channelMentions?: string[];
  updatedAt: string;
  deletedAt: number;
  metadata: string;
  threadMentions?: string[];
  threadSenders?: string[];
  messageChannelName?: string;
  messageType?: string;
}

export interface VespaProjectDocument extends VespaDocument {
  name: string;
  description: string;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface VespaTicketDocument extends Omit<VespaDocument, 'orgId' | 'workspaceId'> {
  convId: string;
  userGroupId: string;
  channelRef: string;
  channelWeightedSet?: Record<string, number>;
  projectRef: string;
  threadId: string;
  status: TicketStatusV2;
  ownerEmail: string;
  assignedTo: string;
  createdBy: string;
  closedBy: string;
  title: string;
  workflowType: string;
  description: string;
  description_clean?: string;
  chunks: string[];
  ticketType: string;
  priority: TicketPriority;
  stage: string;
  createdAtTimestamp: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
  deletedAt: string;
  parentTicketId: string;
  boardId: string;
  attachmentIds: string[];
  metadata: string;
  formFields: TicketFormFields;
  eta: string;
  channelName: string;
  boardName: string;
  xyneId: string;
  tags: string[];
  generatedTags: string[];
  createdByName: string;
  assignedToName: string;
  closedByName: string;
  projectName: string;
  projectCode: string;
  ticketMentions: string[];
  threadMentions: string[];
  threadSenders: string[];
  replyCount: number;
  initialMessage: string;
  initialMessageSender: string;
  parentTicketXyneId: string;
  childTicketXyneIds: string[];
}

export interface VespaUserDocument extends VespaDocument {
  name: string;
  email: string;
  status: UserStatus;
  userGroupIds: string[];
  photoLink: string;
  language: string;
  orgName: string;
  orgLocation: string;
  orgDescription: string;
  isAdmin: boolean;
  createdAt: number;
  lastLoggedIn: number;
  owner: string;
  // Personalization signals — owned exclusively by PersonalizationSyncWorker. The
  // profile-ingestion path (setupUserVespaSync → transformUserToVespa) must NEVER write
  // these: it uses a partial `update` job (never a full `feed`) and omits them, so the
  // worker's values survive. Writing them from a profile update — or feeding the whole
  // doc — would overwrite/wipe them.
  channelWeights?: Record<string, number>;
  userWeights?: Record<string, number>;
  channelTimestamps?: Record<string, number>;
  userTimestamps?: Record<string, number>;
  personalizationLastUpdated?: number;
}

export interface VespaEntityTags {
  people: string[];
  merchants: string[];
  productSpecs: string[];
}

export interface VespaChunkMeta {
  chunk_index: number;
  page_numbers: number[];
  block_labels: string[];
}

export interface VespaFileDocument extends VespaDocument {
  fileName: string;
  description: string;
  chunks: string[];
  chunks_pos: string[];
  chunks_map?: VespaChunkMeta[];
  image_chunks: string[];
  image_chunks_pos: string[];
  slideUrl?: string[];
  image_chunks_map?: VespaChunkMeta[];
  metadata: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  ownerId: string;
  permissions: string[]
  urlInternal: string,
  urlOriginal: string,
  fileSize: number,
  isPrivate: boolean,
  mimeType: string,
  subApp: string,
  channelRef?: string;
  channelWeightedSet?: Record<string, number>;
  conversationId?: string;
  clId?: string,
  clFd?: string,
  projectId?: string,
  tags?: VespaEntityTags;
  messageId?: string;
  ticketId?: string;
  callType?: string;
  documentOutline?: string;
}

export interface PullRequestReference {
  prId: number;
  repoName: string;
  sourceBranchName: string;
  destinationBranchName: string;
  prUrl: string;
  status: string;
}

export interface VespaMemoryDocument extends VespaDocument {
  userId: string;
  sessionId: string;
  repoUrl?: string;
  commitId?: string;
  ticketId?: string;
  userQuery?: string;
  tags: string[];
  filePointers: string[];
  chatSummary: string[];
  rawContent?: string;
  createdAt: number;
  updatedAt: number;
  committedAt?: number;
  agentUsed: string;
  modelUsed: string[];
  parentRef?: string;
  reviewStatus: string;
  relevanceScore?: number;
  pullRequests?: PullRequestReference[];
}

export interface ScoredChunk {
  chunk: string;
  score: number;
  index: number;
}

export interface ChunkScores {
  cells: Record<string, number>;
}

export interface FileMatchFeatures {
  "bm25(title)"?: number;
  "bm25(chunks)"?: number;
  "closeness(field, chunk_embeddings)"?: number;
  chunk_scores: ChunkScores;
  image_chunk_scores?: ChunkScores;
}

export interface VespaFileSearchDocument extends VespaFileDocument {
  sddocname: typeof fileSchema;
  matchfeatures: FileMatchFeatures;
  rankfeatures?: any;
  // default vespa fields
  relevance: number;
  source: string;
  documentid: string;
  // summary fields
  chunks_summary?: (string | ScoredChunk)[];
  image_chunks_summary?: (string | ScoredChunk)[];
  chunks_pos_summary?: number[];
  image_chunks_pos_summary?: number[];
  chunks_map_summary?: VespaChunkMeta[];
}

export interface VespaSamTranscriptDocument extends VespaDocument {
  meetCode: string;
  participants: string[];
  platform: string;
  type: string;
  duration: string;
  meetingSummary: string; // Extracted for Vespa-native embedding generation (renamed from 'summary' - reserved in Vespa)
  chapters?: string;      // JSON.stringify'd Chapter[]
  actionItems?: string;   // JSON.stringify'd ActionItem[]
  others?: string;        // JSON.stringify'd OtherItem[] — free-form insights (speaker, content, tags)
  qna?: string;           // JSON.stringify'd QnA[] — questions and answers from the meeting
  dateTime: number;
  merchants: string[];
}

export interface VespaMailDocument extends VespaDocument {
  threadId: string;
  parentThreadId?: string;
  mailId?: string;
  xyneId?: string;
  /** Project.code of the linked ticket — the "<code>" half of xyneId. */
  projectCode?: string;
  ticketFormFields?: TicketFormFields;
  ticketFormFieldValues?: string[]; // Indexed copy used for Desk/All lexical search.
  subject: string;
  chunks: string[];
  timestamp: number;
  /**
   * ExternalSource.name — e.g. "zoho-euler".
   * null if the source could not be resolved at ingest time.
   */
  app: string | null;
  /**
   * "support_desk" for Desk/support emails; reserved for "personal" (Gmail) in the future.
   * Search filters on `entity contains "support_desk"`.
   */
  entity: string;
  /**
   * Vespa reference to the parent chat_container doc.
   * Permissions are imported live via `import field channelRef.permissions`
   * (declared in mail.sd), so participant changes affect mail visibility
   * without per-email re-feeds.
   */
  channelRef: string;
  channelWeightedSet?: Record<string, number>;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  attachmentFilenames?: string[];
  generatedTags: string[];
}

export interface VespaCallDocument extends VespaDocument {
  callId: string;
  externalId: string;
  channelId: string;
  channelRef: string;
  createdByUserId: string;
  roomLink: string;
  callType: string;
  userIds: string[];
  participantResponses: string[];
  title: string;
  displayTitle: string;
  channelName: string;
  participantNames: string[];
  participantEmails: string[];
  callOrigin: string;
  status: string;
  startsAtTimestamp: number;
  endsAtTimestamp: number;
  startedAtTimestamp: number;
  endedAtTimestamp: number;
  recurringSeriesId: string;
  hasTranscript: boolean;
}

/**
 * Vespa document for the `app` schema (xyne-apps catalog search).
 * `workspaceId` is stamped at feed time from the creator's workspace until the
 * Apps table gains its own column. Creator identity is denormalized for lexical
 * (BM25/fuzzy) matching; only name + description are embedded (see app.sd).
 */
export interface VespaAppDocument {
  docId: string;
  docType: VespaDocType.APP;
  workspaceId: string;
  orgId: string;
  scope: string;
  version: number;
  name: string;
  description: string;
  createdBy: string;
  creatorName: string;
  creatorEmail: string;
  orgName: string;
  createdAt: number;
  updatedAt: number;
}

export type VespaSearchResult =
  | VespaChatContainerDocument
  | VespaChatAttachmentDocument
  | VespaChatMessageDocument
  | VespaTicketDocument
  | VespaProjectDocument
  | VespaUserDocument
  | VespaFileDocument
  | VespaMemoryDocument
  | VespaSamTranscriptDocument
  | VespaMailDocument
  | VespaCallDocument

export interface VespaSearchHit {
  id: string;
  relevance: number;
  source: string;
  fields: VespaSearchResult;
  matchfeatures?: Record<string, any>;
  rankfeatures?: Record<string, any>;
}

export interface VespaSearchResponse {
  root: {
    id: string;
    relevance: number;
    fields?: {
      totalCount: number;
    };
    coverage: {
      coverage: number;
      documents: number;
      full: boolean;
      nodes: number;
      results: number;
      resultsFull: number;
    };
    errors?: Array<{
      code: number;
      summary: string;
      source: string;
      message: string;
    }>;
    children?: VespaSearchHit[];
  };
  trace?: any;
}

export type InsertDocument =
  | VespaChatAttachmentDocument
  | VespaChatContainerDocument
  | VespaChatMessageDocument
  | VespaProjectDocument
  | VespaTicketDocument
  | VespaUserDocument
  | VespaFileDocument
  | VespaMemoryDocument
  | VespaSamTranscriptDocument
  | VespaMailDocument
  | VespaCallDocument
  | VespaAppDocument

export type SchemaDataMap = {
  [messageSchema]: VespaChatMessageDocument;
  [attachmentSchema]: VespaChatAttachmentDocument;
  [channelSchema]: VespaChatContainerDocument;
  [projectSchema]: VespaProjectDocument;
  [ticketSchema]: VespaTicketDocument;
  [userSchema]: VespaUserDocument;
  [fileSchema]: VespaFileDocument;
  [memorySchema]: VespaMemoryDocument;
  [samTranscriptSchema]: VespaSamTranscriptDocument;
  [mailSchema]: VespaMailDocument;
  [appSchema]: VespaAppDocument;
  [callSchema]: VespaCallDocument;
};

export const schemaToDocType: Partial<Record<VespaSchema, VespaDocType>> = {
  [channelSchema]: VespaDocType.CHANNEL,
  [messageSchema]: VespaDocType.MESSAGE,
  [projectSchema]: VespaDocType.PROJECT,
  [ticketSchema]: VespaDocType.TICKET,
  [userSchema]: VespaDocType.USER,
  [attachmentSchema]: VespaDocType.ATTACHMENT,
  [fileSchema]: VespaDocType.FILE,
  [samTranscriptSchema]: VespaDocType.SAM_TRANSCRIPT,
  [mailSchema]: VespaDocType.MAIL,
  [appSchema]: VespaDocType.APP,
  [callSchema]: VespaDocType.CALL,
};

export interface MatchFeatures {
  [key: string]: number | string;
}

export interface MemoryUpdateFields {
  userQuery?: string;
  chatSummary?: string[];
  tags?: string[];
  filePointers?: string[];
  rawContent?: string;
  commitId?: string;
  reviewStatus?: string;
}

export interface MemorySearchRequest {
  query?: string;
  scope: MemoryScope;
  limit: number;
  offset: number;
  includeQuery?: boolean;
  includeSummary?: boolean;
  docType?: VespaDocType;
  tags?: string[];
  repoUrl?: string;
  commitId?: string;
  sessionId?: string;
  filePointers?: string;
  ticketId?: string;
  parentRef?: string;
  reviewStatus?: string;
  docId?: string;
}

export interface MemorySearchResult {
  documents: VespaMemoryDocument[];
  totalCount: number;
  hasMore: boolean;
}
