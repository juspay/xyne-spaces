import { TicketPriority, TicketStatusV2, UserStatus } from "@xyne/shared";

export const ticketSchema = 'ticket';
export const messageSchema = 'chat_message';
export const attachmentSchema = 'chat_attachment';
export const channelSchema = 'chat_container';
export const projectSchema = 'project';
export const userSchema = 'user';
export const fileSchema = 'file'

export type VespaSchema =
  | typeof ticketSchema
  | typeof messageSchema
  | typeof attachmentSchema
  | typeof channelSchema
  | typeof userSchema
  | typeof projectSchema
  | typeof fileSchema

  export const VESPA_SCHEMAS: VespaSchema[] = [
    ticketSchema,
    messageSchema,
    attachmentSchema,
    channelSchema,
    projectSchema,
    userSchema,
    fileSchema
  ];

// Deprecated: Use VESPA_SCHEMAS instead
export const AllSources: VespaSchema[] = VESPA_SCHEMAS;
export enum VespaDocType {
  TICKET = 'ticket',
  MESSAGE = 'message',
  ATTACHMENT = 'attachment',
  CHANNEL = 'channel',
  PROJECT = 'project',
  USER = 'user',
  FILE = 'file'
}

export interface VespaDocument {
  docId: string;
  docType: VespaDocType;
}

export interface importedTicketFields {
  channelId: string;
  projectId: string;
}

export interface importedChannelFields {
  isIm: boolean;
  isMpim: boolean;
  channelName: string;
  channelId: string;
  permissions: string[];
}

export enum RankProfile {
  nativeRank = "default_native",
  personalizedRank = 'personalized',
  fuzzyRank = 'default_fuzzy'
}

export type User = {
  id:  string,
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

export interface VespaChatMessageDocument extends VespaDocument {
  text: string;
  userId: string;
  username: string;
  userEmail: string;
  image: string;
  createdAt: string;
  createdAtTimestamp: number;
  threadId: string;
  channelWeightedSet: any,
  userWeightedSet: any,
  channelRef: string;
  attachmentIds: string[];
  reactions: number;
  replyCount: number;
  replyUsersCount: number;
  mentions: string[];
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

export interface VespaTicketDocument extends VespaDocument {
  convId: string;
  userGroupId: string;
  channelRef: string;
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
  eta: string;
  channelName: string;
  boardName: string;
  xyneId: string;
  tags: string[];
  createdByName: string;
  assignedToName: string;
  closedByName: string;
  projectName: string;
  ticketMentions: string[];
  threadMentions: string[];
  threadSenders: string[];
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
  channelWeights?: Record<string, number>;
  userWeights?: Record<string, number>;
  channelTimestamps?: Record<string, number>;
  userTimestamps?: Record<string, number>;
  personalizationLastUpdated?: number;
}

export interface VespaFileDocument extends VespaDocument {
  fileName: string;
  description: string;
  chunks: string[];
  chunks_pos: string[];
  image_chunks: string[];
  image_chunks_pos: string[];
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
}

export type VespaSearchResult =
  | VespaChatContainerDocument
  | VespaChatAttachmentDocument
  | VespaChatMessageDocument
  | VespaTicketDocument
  | VespaProjectDocument
  | VespaUserDocument
  | VespaFileDocument;

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
  | VespaUserDocument;

export type SchemaDataMap = {
  [messageSchema]: VespaChatMessageDocument;
  [attachmentSchema]: VespaChatAttachmentDocument;
  [channelSchema]: VespaChatContainerDocument;
  [projectSchema]: VespaProjectDocument;
  [ticketSchema]: VespaTicketDocument;
  [userSchema]: VespaUserDocument;
  [fileSchema]: VespaFileDocument;
};

export const schemaToDocType: Record<VespaSchema, VespaDocType> = {
  [channelSchema]: VespaDocType.CHANNEL,
  [messageSchema]: VespaDocType.MESSAGE,
  [projectSchema]: VespaDocType.PROJECT,
  [ticketSchema]: VespaDocType.TICKET,
  [userSchema]: VespaDocType.USER,
  [attachmentSchema]: VespaDocType.ATTACHMENT,
  [fileSchema]: VespaDocType.FILE
};

export interface MatchFeatures {
  [key: string]: number | string;
}