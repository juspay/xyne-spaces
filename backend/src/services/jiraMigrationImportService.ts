import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { encrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import {
  ActivityType,
  AttachmentEntityType,
  ConversationParticipation,
  ExternalEntityType,
  FormContextType,
  FormEntityType,
  FormFieldType,
  MessageDirection,
  MessageType,
  TicketPriority,
  TicketReferenceRelation,
  TicketStatusV2,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { serializeTicketMd, type TicketCardSummary } from '@xyne/shared';
import { adfToHtmlAsync, adfToText } from '@/services/jira/adfHtml';
import { JiraMigrationClient } from '@/services/jira/client';
import { JiraUserResolver } from '@/services/jira/userResolver';
import { TicketIdService } from '@/services/ticketIdService';
import {
  queueJiraImportAttachmentVespaJob,
  queueJiraImportMessageVespaJob,
  queueJiraImportTicketVespaJob,
} from '@/services/jira/vespa';

type JiraFieldDefinition = {
  id: string;
  name: string;
  schema?: {
    type?: string;
    items?: string;
    custom?: string;
  };
};

type JiraUser = {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
};

type JiraAttachment = {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
  created?: string;
  content?: string;
  author?: JiraUser;
};

type JiraComment = {
  id: string;
  body?: unknown;
  created?: string;
  updated?: string;
  author?: JiraUser;
};

type JiraCommentMediaRef = {
  mediaId: string;
  width?: number;
  height?: number;
};

type JiraCommentAttachmentMatch = {
  mediaRef: JiraCommentMediaRef;
  attachment: JiraAttachment;
  score: number;
};

type JiraIssueLink = {
  id?: string;
  type?: {
    name?: string;
    inward?: string;
    outward?: string;
  };
  inwardIssue?: { id: string; key: string };
  outwardIssue?: { id: string; key: string };
};

type JiraIssue = {
  id: string;
  key: string;
  fields: Record<string, any>;
};

type CachedTicketRecord = {
  id: string;
  conversationId: string | null;
  xyneId: string | null;
  title: string;
  description: string | null;
  createdBy: string;
  assignedTo: string | null;
  metadata: any;
};

export interface JiraMigrationExecuteInput {
  jiraProjectKey: string;
  targetProjectId: string;
  targetBoardId: string;
  targetChannelId: string;
  issueKeys?: string[];
  dateFrom?: string;
}

export interface JiraMigrationIssueResult {
  issueKey: string;
  summary: string;
  status: 'completed' | 'partial' | 'failed';
  failedStep: 'ticket' | 'ticket_resolution' | 'external_mapping' | 'form_values' | 'comments' | 'attachments' | 'comment_attachments' | null;
  errors: string[];
}

export interface JiraMigrationExecuteResult {
  jiraProjectKey: string;
  externalSourceCreated: boolean;
  externalSourceId?: string;
  importedTickets: number;
  skippedTickets: number;
  importedComments: number;
  skippedComments: number;
  importedAttachments: number;
  skippedAttachments: number;
  createdBoardCustomFields: number;
  reusedBoardCustomFields: number;
  linkedTickets: number;
  createdSubTickets: number;
  unresolvedUsers: Array<{
    displayName: string | null;
    accountId: string | null;
    suggestedEmails: string[];
  }>;
  issueResults: JiraMigrationIssueResult[];
  warnings: string[];
}

export interface JiraMigrationProgressUpdate {
  totalIssues: number;
  processedIssues: number;
  importedTickets: number;
  skippedTickets: number;
  importedComments: number;
  skippedComments: number;
  importedAttachments: number;
  skippedAttachments: number;
  currentIssueKey: string | null;
  currentStep: string | null;
  warnings: string[];
  issueResult?: JiraMigrationIssueResult;
}

const db = DatabaseClient.getInstance();

const BOARD_FIELD_TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  date: 'DATE',
  datetime: 'DATE',
  option: 'SINGLE_SELECT',
  array: 'MULTI_SELECT',
  user: 'USER',
  boolean: 'BOOLEAN',
};

const sanitizeFieldName = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '')
    .trim();

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const JIRA_CUSTOM_FIELD_NAME_SKIP_PATTERNS = [
  'rank',
  'epiclink',
  'epiclinkdeprecated',
  'development',
  'timeinstatus',
  'charttimeinstatus',
  'requiredfields',
  'go-livechecklist',
  'golivechecklist',
  'checklistsheet',
];

const JIRA_CUSTOM_FIELD_CUSTOM_SCHEMA_SKIP_PATTERNS = [
  'lexorank',
  'epiclink',
  'development',
  'timeinstatus',
];

const isOpaqueJiraCustomFieldString = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return true;

  return (
    /\{[a-z]+\=/.test(trimmed) ||
    trimmed.includes('json={\"cachedValue\"') ||
    trimmed.includes('dataType=pullrequest') ||
    /\d+_\*:.*\|\*_/.test(trimmed)
  );
};

const extractMeaningfulJiraCustomFieldValues = (value: unknown): string[] => {
  if (value === null || value === undefined) return [];

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed && !isOpaqueJiraCustomFieldString(trimmed) ? [trimmed] : [];
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return [...new Set(value.flatMap(item => extractMeaningfulJiraCustomFieldValues(item)).filter(Boolean))];
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    const directCandidates = [obj.displayName, obj.name, obj.value, obj.label]
      .filter((candidate): candidate is string => typeof candidate === 'string')
      .map(candidate => candidate.trim())
      .filter(candidate => candidate && !isOpaqueJiraCustomFieldString(candidate));

    if (directCandidates.length > 0) {
      return [...new Set(directCandidates)];
    }

    if (typeof obj.key === 'string' && /^[A-Z][A-Z0-9_]+-\d+$/.test(obj.key.trim())) {
      return [obj.key.trim()];
    }

    return [];
  }

  return [];
};

const valueToPreviewString = (value: unknown): string =>
  extractMeaningfulJiraCustomFieldValues(value).join(', ');

const extractJiraUsersFromCustomFieldValue = (value: unknown): JiraUser[] => {
  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return value.flatMap(item => extractJiraUsersFromCustomFieldValue(item));
  }

  if (typeof value !== 'object') {
    return [];
  }

  const user = value as JiraUser;
  if (!user.accountId && !user.displayName && !user.emailAddress) {
    return [];
  }

  return [user];
};

const shouldSkipJiraCustomField = (definition?: JiraFieldDefinition): boolean => {
  if (!definition) return false;

  const normalizedName = normalize(definition.name || '');
  const normalizedCustom = normalize(definition.schema?.custom || '');

  return (
    JIRA_CUSTOM_FIELD_NAME_SKIP_PATTERNS.some(pattern => normalizedName.includes(pattern)) ||
    JIRA_CUSTOM_FIELD_CUSTOM_SCHEMA_SKIP_PATTERNS.some(pattern => normalizedCustom.includes(pattern))
  );
};

const TICKET_PRELOAD_QUERY_BATCH_SIZE = 1000;
const EXTERNAL_MAPPING_PRELOAD_QUERY_BATCH_SIZE = 2000;
const FORM_VALUE_PRELOAD_TICKET_BATCH_SIZE = 500;
const FORM_VALUE_PRELOAD_FIELD_BATCH_SIZE = 100;
const COMMENT_MESSAGE_PRELOAD_BATCH_SIZE = 1000;
const ATTACHMENT_PRELOAD_BATCH_SIZE = 1000;
const ATTACHMENT_ENTITY_PRELOAD_BATCH_SIZE = 500;
const ATTACHMENT_IMPORT_CONCURRENCY = 4;

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};


const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= items.length) {
          break;
        }

        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
};


const inferXyneFieldType = (field: JiraFieldDefinition, sampleValues: string[]): FormFieldType => {
  const schemaType = field.schema?.type;
  const schemaItems = field.schema?.items;

  if (schemaType === 'array' && schemaItems === 'user') return FormFieldType.USER;
  if (schemaType === 'user') return FormFieldType.USER;
  if (schemaType && BOARD_FIELD_TYPE_MAP[schemaType]) return BOARD_FIELD_TYPE_MAP[schemaType] as FormFieldType;
  if (schemaType === 'array') return FormFieldType.MULTI_SELECT;

  const hasBoolean = sampleValues.some(v => v === 'true' || v === 'false');
  if (hasBoolean) return FormFieldType.BOOLEAN;

  const hasOnlyNumbers =
    sampleValues.length > 0 && sampleValues.every(v => /^-?\d+(\.\d+)?$/.test(v));
  if (hasOnlyNumbers) return FormFieldType.NUMBER;

  return FormFieldType.STRING;
};

const mapPriority = (value?: string): TicketPriority => {
  const normalized = (value || '').toLowerCase();
  if (normalized.includes('highest') || normalized.includes('high')) return TicketPriority.HIGH;
  if (normalized.includes('medium')) return TicketPriority.MEDIUM;
  return TicketPriority.LOW;
};

const normalizeNamePart = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizeComparableValue = (value?: string | null): string => normalizeNamePart(value || '');

const resolveJiraParentIssueKey = (
  issue: JiraIssue,
  fieldDefinitions: JiraFieldDefinition[],
): string | null => {
  const directParentKey = issue.fields.parent?.key;
  if (typeof directParentKey === 'string' && directParentKey.trim()) {
    return directParentKey.trim().toUpperCase();
  }

  const epicLinkFieldIds = fieldDefinitions
    .filter(field => {
      const normalizedName = normalize(field.name || '');
      const normalizedCustom = normalize(field.schema?.custom || '');
      return (
        normalizedName === 'epiclink' ||
        normalizedName === 'epic_link' ||
        normalizedName === 'epiclinkdeprecated' ||
        normalizedCustom.includes('epiclink')
      );
    })
    .map(field => field.id);

  for (const fieldId of epicLinkFieldIds) {
    const rawEpicLink = issue.fields[fieldId];
    if (typeof rawEpicLink === 'string' && rawEpicLink.trim()) {
      return rawEpicLink.trim().toUpperCase();
    }
  }

  return null;
};

const buildJiraMigrationProjectLogPrefix = (jiraProjectKey: string): string =>
  `[jira-migration][${jiraProjectKey}]`;

const buildJiraMigrationIssueLogPrefix = (jiraProjectKey: string, issue: JiraIssue): string =>
  `${buildJiraMigrationProjectLogPrefix(jiraProjectKey)}[${issue.id}]`;

const inferStageStatusV2 = (jiraStatus: string): TicketStatusV2 => {
  const lower = jiraStatus.toLowerCase();

  if (
    lower.includes('done') ||
    lower.includes('closed') ||
    lower.includes('resolved') ||
    lower.includes('complete') ||
    lower.includes('deployed')
  ) {
    return TicketStatusV2.COMPLETED;
  }

  if (
    lower.includes('progress') ||
    lower.includes('review') ||
    lower.includes('qa') ||
    lower.includes('testing') ||
    lower.includes('blocked') ||
    lower.includes('hold')
  ) {
    return TicketStatusV2.STARTED;
  }

  if (lower.includes('cancel') || lower.includes('wont')) {
    return TicketStatusV2.CANCELLED;
  }

  if (lower.includes('pause') || lower.includes('waiting') || lower.includes('pending')) {
    return TicketStatusV2.PAUSED;
  }

  return TicketStatusV2.TODO;
};

type JiraStageSummary = {
  id: string;
  name: string;
  sequenceNumber: number;
  defaultTicketStatusV2: TicketStatusV2;
};

const inferStatusMatch = (
  jiraStatus: string,
  stages: Array<{ name: string; sequenceNumber: number; defaultTicketStatusV2: TicketStatusV2 }>,
): { stageName: string; statusV2: TicketStatusV2 } => {
  const exact = stages.find(stage => normalize(stage.name) === normalize(jiraStatus));
  if (exact) {
    return { stageName: exact.name, statusV2: exact.defaultTicketStatusV2 };
  }

  const contains = stages.find(stage => {
    const stageValue = normalize(stage.name);
    const jiraValue = normalize(jiraStatus);
    return stageValue.includes(jiraValue) || jiraValue.includes(stageValue);
  });

  if (contains) {
    return { stageName: contains.name, statusV2: contains.defaultTicketStatusV2 };
  }

  const lower = jiraStatus.toLowerCase();
  if (lower.includes('done') || lower.includes('closed') || lower.includes('resolved')) {
    const completed = stages.find(stage => stage.defaultTicketStatusV2 === TicketStatusV2.COMPLETED);
    if (completed) return { stageName: completed.name, statusV2: completed.defaultTicketStatusV2 };
  }
  if (lower.includes('progress') || lower.includes('review') || lower.includes('qa')) {
    const started = stages.find(stage => stage.defaultTicketStatusV2 === TicketStatusV2.STARTED);
    if (started) return { stageName: started.name, statusV2: started.defaultTicketStatusV2 };
  }

  const first = stages[0];
  return {
    stageName: first?.name || jiraStatus,
    statusV2: first?.defaultTicketStatusV2 || TicketStatusV2.TODO,
  };
};



export class JiraMigrationImportService {
  private ticketRepository = new TicketRepository();
  private jiraClient = new JiraMigrationClient();
  private userResolver = new JiraUserResolver();
  private externalSourceRepository = new ExternalSourceRepository();
  private cachedTicketsByIssueId = new Map<string, CachedTicketRecord>();
  private cachedTicketsByIssueKey = new Map<string, CachedTicketRecord>();
  private existingExternalTicketMappings = new Set<string>();
  private pendingExternalTicketMappings: Array<{
    externalSourceId: string;
    externalId: string;
    externalThreadId: string;
    entityId: string;
    direction: MessageDirection;
    entityType: ExternalEntityType;
  }> = [];
  private existingFormValuesByKey = new Map<string, string>();
  private existingCommentMessagesByKey = new Map<string, string>();
  private existingAttachmentsByKey = new Map<string, {
    id: string;
    size: number;
    mimetype: string;
    url: string;
  }>();

  private queueMessageVespaJobs(messages: Array<{ messageId: string; userId: string }>): void {
    for (const message of messages) {
      queueJiraImportMessageVespaJob(message.messageId, message.userId);
    }
  }

  private queueTicketVespaJob(ticketId: string, userId: string): void {
    queueJiraImportTicketVespaJob(ticketId, userId);
  }

  private queueAttachmentVespaJobs(attachments: Array<{ attachmentId: string; userId: string }>): void {
    for (const attachment of attachments) {
      queueJiraImportAttachmentVespaJob(attachment.attachmentId, attachment.userId);
    }
  }

  private resetExecutionCaches(): void {
    this.cachedTicketsByIssueId.clear();
    this.cachedTicketsByIssueKey.clear();
    this.existingExternalTicketMappings.clear();
    this.pendingExternalTicketMappings = [];
    this.existingFormValuesByKey.clear();
    this.existingCommentMessagesByKey.clear();
    this.existingAttachmentsByKey.clear();
    this.userResolver.reset();
  }

  private cacheTicketRecord(ticket: CachedTicketRecord, issueId?: string | null, issueKey?: string | null): void {
    if (issueId) {
      this.cachedTicketsByIssueId.set(issueId, ticket);
    }

    const resolvedIssueKey = issueKey || ((ticket.metadata as Record<string, any> | null)?.source?.jira?.issueKey as string | undefined) || ticket.xyneId;
    if (resolvedIssueKey) {
      this.cachedTicketsByIssueKey.set(resolvedIssueKey, ticket);
    }
  }

  private getCachedTicketRecord(issueId: string, issueKey: string): CachedTicketRecord | null {
    return this.cachedTicketsByIssueId.get(issueId) || this.cachedTicketsByIssueKey.get(issueKey) || null;
  }

  private buildFormValueCacheKey(entityId: string, fieldId: string, contextId: string): string {
    return `${entityId}:${fieldId}:${contextId}`;
  }

  private buildCommentMessageCacheKey(conversationId: string, commentId: string): string {
    return `${conversationId}:${commentId}`;
  }

  private buildAttachmentCacheKey(entityId: string, attachmentId: string): string {
    return `${entityId}:${attachmentId}`;
  }

  private async preloadExistingCommentMessages(conversationId: string, commentIds: string[]): Promise<void> {
    if (commentIds.length === 0) return;

    const commentIdChunks = chunkArray(commentIds, COMMENT_MESSAGE_PRELOAD_BATCH_SIZE);

    for (const commentIdChunk of commentIdChunks) {
      const existingMessages = await db.message.findMany({
        where: {
          conversationId,
          OR: commentIdChunk.map(commentId => ({
            metadata: { path: ['source', 'jira', 'commentId'], equals: commentId },
          })),
        },
        select: {
          messageId: true,
          metadata: true,
        },
      });

      for (const message of existingMessages) {
        const commentId = (message.metadata as Record<string, any> | null)?.source?.jira?.commentId as string | undefined;
        if (!commentId) continue;
        this.existingCommentMessagesByKey.set(
          this.buildCommentMessageCacheKey(conversationId, commentId),
          message.messageId,
        );
      }
    }
  }

  private async preloadExistingAttachments(entityId: string, attachmentIds: string[]): Promise<void> {
    if (attachmentIds.length === 0) return;

    const attachmentIdChunks = chunkArray(attachmentIds, ATTACHMENT_PRELOAD_BATCH_SIZE);

    for (const attachmentIdChunk of attachmentIdChunks) {
      const existingAttachments = await db.messageAttachment.findMany({
        where: {
          entityId,
          OR: attachmentIdChunk.map(attachmentId => ({
            metadata: { path: ['source', 'jira', 'attachmentId'], equals: attachmentId },
          })),
        },
        select: {
          id: true,
          size: true,
          mimetype: true,
          url: true,
          metadata: true,
        },
      });

      for (const attachment of existingAttachments) {
        const attachmentId = (attachment.metadata as Record<string, any> | null)?.source?.jira?.attachmentId as string | undefined;
        if (!attachmentId) continue;
        this.existingAttachmentsByKey.set(this.buildAttachmentCacheKey(entityId, attachmentId), {
          id: attachment.id,
          size: attachment.size,
          mimetype: attachment.mimetype,
          url: attachment.url,
        });
      }
    }
  }

  private async preloadExistingAttachmentsForEntities(entityIds: string[], attachmentIds: string[]): Promise<void> {
    if (entityIds.length === 0 || attachmentIds.length === 0) return;

    const entityIdChunks = chunkArray(entityIds, ATTACHMENT_ENTITY_PRELOAD_BATCH_SIZE);
    const attachmentIdChunks = chunkArray(attachmentIds, ATTACHMENT_PRELOAD_BATCH_SIZE);

    for (const entityIdChunk of entityIdChunks) {
      for (const attachmentIdChunk of attachmentIdChunks) {
        const existingAttachments = await db.messageAttachment.findMany({
          where: {
            entityId: { in: entityIdChunk },
            OR: attachmentIdChunk.map(attachmentId => ({
              metadata: { path: ['source', 'jira', 'attachmentId'], equals: attachmentId },
            })),
          },
          select: {
            id: true,
            entityId: true,
            size: true,
            mimetype: true,
            url: true,
            metadata: true,
          },
        });

        for (const attachment of existingAttachments) {
          const attachmentId = (attachment.metadata as Record<string, any> | null)?.source?.jira?.attachmentId as string | undefined;
          if (!attachmentId) continue;
          this.existingAttachmentsByKey.set(this.buildAttachmentCacheKey(attachment.entityId, attachmentId), {
            id: attachment.id,
            size: attachment.size,
            mimetype: attachment.mimetype,
            url: attachment.url,
          });
        }
      }
    }
  }

  private async preloadExistingTickets(issues: JiraIssue[]): Promise<void> {
    if (issues.length === 0) return;

    const uniqueIssueIds = [...new Set(issues.map(issue => issue.id).filter(Boolean))];
    const uniqueIssueKeys = [...new Set(issues.map(issue => issue.key).filter(Boolean))];
    const issueIdChunks = chunkArray(uniqueIssueIds, TICKET_PRELOAD_QUERY_BATCH_SIZE);
    const issueKeyChunks = chunkArray(uniqueIssueKeys, TICKET_PRELOAD_QUERY_BATCH_SIZE);
    const existingTicketsById = new Map<string, any>();

    const queryCount = Math.max(issueIdChunks.length, issueKeyChunks.length);
    for (let index = 0; index < queryCount; index += 1) {
      const issueIdsBatch = issueIdChunks[index] || [];
      const issueKeysBatch = issueKeyChunks[index] || [];
      const whereClauses = [
        ...issueIdsBatch.map(issueId => ({ metadata: { path: ['source', 'jira', 'issueId'], equals: issueId } })),
        ...issueKeysBatch.map(issueKey => ({ metadata: { path: ['source', 'jira', 'issueKey'], equals: issueKey } })),
      ];

      if (whereClauses.length === 0) {
        continue;
      }

      const existingTickets = await db.ticket.findMany({
        where: {
          OR: whereClauses,
        },
        select: {
          id: true,
          conversationId: true,
          xyneId: true,
          title: true,
          description: true,
          createdBy: true,
          assignedTo: true,
          metadata: true,
        },
      });

      for (const ticket of existingTickets) {
        existingTicketsById.set(ticket.id, ticket);
      }
    }

    for (const ticket of existingTicketsById.values()) {
      const metadata = (ticket.metadata as Record<string, any> | null) || null;
      const cachedTicket: CachedTicketRecord = {
        id: ticket.id,
        conversationId: ticket.conversationId,
        xyneId: ticket.xyneId,
        title: ticket.title,
        description: ticket.description,
        createdBy: ticket.createdBy,
        assignedTo: ticket.assignedTo,
        metadata,
      };

      this.cacheTicketRecord(
        cachedTicket,
        metadata?.source?.jira?.issueId || null,
        metadata?.source?.jira?.issueKey || ticket.xyneId || null,
      );
    }
  }

  private async preloadExistingExternalMappings(externalSourceId: string, issues: JiraIssue[]): Promise<void> {
    if (issues.length === 0) return;

    const issueIds = [...new Set(issues.map(issue => issue.id).filter(Boolean))];
    if (issueIds.length === 0) return;

    const issueIdChunks = chunkArray(issueIds, EXTERNAL_MAPPING_PRELOAD_QUERY_BATCH_SIZE);

    for (const issueIdChunk of issueIdChunks) {
      const existingMappings = await db.externalMessage.findMany({
        where: {
          externalSourceId,
          externalId: { in: issueIdChunk },
        },
        select: {
          externalId: true,
        },
      });

      for (const mapping of existingMappings) {
        this.existingExternalTicketMappings.add(mapping.externalId);
      }
    }
  }

  private async preloadExistingFormValues(ticketIds: string[], fieldIds: string[], contextId: string): Promise<void> {
    if (ticketIds.length === 0 || fieldIds.length === 0) return;

    const ticketIdChunks = chunkArray(ticketIds, FORM_VALUE_PRELOAD_TICKET_BATCH_SIZE);
    const fieldIdChunks = chunkArray(fieldIds, FORM_VALUE_PRELOAD_FIELD_BATCH_SIZE);

    for (const ticketIdChunk of ticketIdChunks) {
      for (const fieldIdChunk of fieldIdChunks) {
        const existingValues = await db.formEntityValues.findMany({
          where: {
            entityType: FormEntityType.TICKET,
            contextId,
            entityId: { in: ticketIdChunk },
            fieldId: { in: fieldIdChunk },
          },
          select: {
            id: true,
            entityId: true,
            fieldId: true,
            contextId: true,
          },
        });

        for (const value of existingValues) {
          if (!value.contextId) continue;

          this.existingFormValuesByKey.set(
            this.buildFormValueCacheKey(value.entityId, value.fieldId, value.contextId),
            value.id,
          );
        }
      }
    }
  }

  private async ensureBoardCustomFieldsIncremental(
    boardId: string,
    boardName: string,
    actorUserId: string,
    fieldDefinitions: JiraFieldDefinition[],
    issues: JiraIssue[],
    existingFieldMap: Map<string, { fieldId: string; fieldType: string }>,
  ): Promise<{
    formId: string | null;
    createdCount: number;
    reusedCount: number;
    fieldMap: Map<string, { fieldId: string; fieldType: string }>;
  }> {
    const customFieldStats = new Map<string, { values: Set<string>; issueCoverageCount: number }>();
    const fieldDefinitionMap = new Map(fieldDefinitions.map(field => [field.id, field]));

    for (const issue of issues) {
      for (const [fieldId, rawValue] of Object.entries(issue.fields)) {
        if (!fieldId.startsWith('customfield_')) continue;
        if (existingFieldMap.has(fieldId)) continue;
        if (shouldSkipJiraCustomField(fieldDefinitionMap.get(fieldId))) continue;
        if (rawValue === null || rawValue === undefined) continue;
        if (Array.isArray(rawValue) && rawValue.length === 0) continue;
        if (typeof rawValue === 'string' && rawValue.trim() === '') continue;

        const previewValue = valueToPreviewString(rawValue);
        if (!previewValue) continue;

        const stat = customFieldStats.get(fieldId) || { values: new Set<string>(), issueCoverageCount: 0 };
        stat.issueCoverageCount += 1;
        stat.values.add(previewValue);
        customFieldStats.set(fieldId, stat);
      }
    }

    if (customFieldStats.size === 0) {
      return { formId: null, createdCount: 0, reusedCount: 0, fieldMap: new Map() };
    }

    const formId = await this.ensureBoardForm(boardId, boardName, actorUserId);
    const existingFields = await db.formFields.findMany({
      where: { formId },
      orderBy: { createdAt: 'asc' },
    });

    const fieldMap = new Map<string, { fieldId: string; fieldType: string }>();
    let createdCount = 0;
    let reusedCount = 0;
    const existingFieldsByNormalizedName = new Map(
      existingFields.map(field => [normalize(field.fieldName), field]),
    );
    const fieldsToCreate: Array<{
      jiraFieldId: string;
      normalizedFieldName: string;
      fieldName: string;
      fieldType: FormFieldType;
    }> = [];

    for (const [fieldId, stats] of customFieldStats.entries()) {
      const definition = fieldDefinitionMap.get(fieldId);
      const jiraFieldName = definition?.name || fieldId;
      const sampleValues = Array.from(stats.values).slice(0, 50);
      const suggestedXyneFieldName = sanitizeFieldName(jiraFieldName);
      const suggestedXyneFieldType = inferXyneFieldType(
        definition || { id: fieldId, name: jiraFieldName },
        sampleValues,
      ) as FormFieldType;

      const isComplexUnsupported =
        definition?.schema?.custom?.includes('cascadingselect') ||
        definition?.schema?.custom?.includes('grouppicker') ||
        definition?.schema?.custom?.includes('version') ||
        definition?.schema?.custom?.includes('project');

      if (isComplexUnsupported) {
        continue;
      }

      const normalizedFieldName = normalize(suggestedXyneFieldName);
      const existing = existingFieldsByNormalizedName.get(normalizedFieldName);
      if (existing) {
        reusedCount += 1;
        fieldMap.set(fieldId, { fieldId: existing.id, fieldType: existing.fieldType });
        continue;
      }

      fieldsToCreate.push({
        jiraFieldId: fieldId,
        normalizedFieldName,
        fieldName: suggestedXyneFieldName,
        fieldType: suggestedXyneFieldType,
      });
    }

    if (fieldsToCreate.length > 0) {
      await db.formFields.createMany({
        data: fieldsToCreate.map(field => ({
          formId,
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          isOptional: true,
        })),
        skipDuplicates: true,
      });

      const refreshedFields = await db.formFields.findMany({
        where: {
          formId,
          fieldName: { in: fieldsToCreate.map(field => field.fieldName) },
        },
      });

      for (const field of refreshedFields) {
        existingFieldsByNormalizedName.set(normalize(field.fieldName), field);
      }

      createdCount += fieldsToCreate.length;
    }

    for (const field of fieldsToCreate) {
      const created = existingFieldsByNormalizedName.get(field.normalizedFieldName);
      if (!created) {
        continue;
      }

      fieldMap.set(field.jiraFieldId, { fieldId: created.id, fieldType: created.fieldType });
    }

    return {
      formId,
      createdCount,
      reusedCount,
      fieldMap,
    };
  }

  private buildIssueRelationshipSnapshot(issue: JiraIssue, parentFieldIds: string[]): JiraIssue {
    const fields: Record<string, any> = {
      parent: issue.fields.parent,
      issuelinks: issue.fields.issuelinks,
    };

    for (const fieldId of parentFieldIds) {
      if (fieldId in issue.fields) {
        fields[fieldId] = issue.fields[fieldId];
      }
    }

    return {
      id: issue.id,
      key: issue.key,
      fields,
    };
  }

  private async ensureExactJiraStages(
    boardId: string,
    actorUserId: string,
    issues: JiraIssue[],
    stages: JiraStageSummary[],
  ): Promise<JiraStageSummary[]> {
    const existingStageNames = new Set(stages.map(stage => normalize(stage.name)));
    const missingStageNames: string[] = [];

    for (const issue of issues) {
      const statusName = issue.fields.status?.name?.trim();
      if (!statusName) continue;

      const normalizedStatusName = normalize(statusName);
      if (!normalizedStatusName || existingStageNames.has(normalizedStatusName)) {
        continue;
      }

      existingStageNames.add(normalizedStatusName);
      missingStageNames.push(statusName);
    }

    if (missingStageNames.length === 0) {
      return stages;
    }

    let nextSequenceNumber =
      stages.reduce((maxValue, stage) => Math.max(maxValue, stage.sequenceNumber), 0) + 1;

    for (const stageName of missingStageNames) {
      const createdStage = await db.stage.create({
        data: {
          name: stageName,
          boardId,
          sequenceNumber: nextSequenceNumber,
          createdBy: actorUserId,
          defaultTicketStatusV2: inferStageStatusV2(stageName),
        },
      });

      stages.push({
        id: createdStage.id,
        name: createdStage.name,
        sequenceNumber: createdStage.sequenceNumber,
        defaultTicketStatusV2: createdStage.defaultTicketStatusV2,
      });

      nextSequenceNumber += 1;
    }

    stages.sort((left, right) => left.sequenceNumber - right.sequenceNumber);

    return stages;
  }

  private async ensureBoardForm(boardId: string, boardName: string, actorUserId: string) {
    const existingMapping = await db.formContextMapping.findFirst({
      where: {
        contextId: boardId,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
    });

    if (existingMapping) {
      return existingMapping.formId;
    }

    const form = await db.form.create({
      data: {
        formName: `${boardName} Imported Jira Fields`,
        formDescription: `Imported Jira custom fields for ${boardName}`,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
        createdBy: actorUserId,
      },
    });

    await db.formContextMapping.create({
      data: {
        formId: form.id,
        contextId: boardId,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
    });

    const board = await db.board.findUnique({ where: { id: boardId } });
    const metadata = ((board?.metadata as Record<string, unknown> | null) || {}) as Record<string, unknown>;
    await db.board.update({
      where: { id: boardId },
      data: {
        metadata: {
          ...metadata,
          customFieldsFormId: form.id,
        },
      },
    });

    return form.id;
  }


  private async normalizeFormValue(
    rawValue: any,
    fieldType: string,
    fallbackUserId: string,
    unresolvedUsers: Map<string, { displayName: string | null; accountId: string | null; suggestedEmails: string[] }>,
  ): Promise<any> {
    if (rawValue === null || rawValue === undefined) return null;

    if (fieldType === 'USER') {
      const jiraUsers = extractJiraUsersFromCustomFieldValue(rawValue);
      if (jiraUsers.length === 0) {
        return null;
      }

      const resolvedUserIds = [
        ...new Set(
          (await Promise.all(
            jiraUsers.map(user => this.userResolver.resolveUser(user, fallbackUserId, unresolvedUsers)),
          )).filter(Boolean),
        ),
      ];

      return resolvedUserIds.length > 0 ? resolvedUserIds : null;
    }

    const meaningfulValues = extractMeaningfulJiraCustomFieldValues(rawValue);
    if (meaningfulValues.length === 0) {
      return null;
    }

    if (fieldType === 'MULTI_SELECT') {
      return meaningfulValues;
    }

    return meaningfulValues.join(', ');
  }

  private async findExistingTicketByJiraId(issueId: string, issueKey: string) {
    const cachedTicket = this.getCachedTicketRecord(issueId, issueKey);
    if (cachedTicket) {
      return cachedTicket;
    }

    const byId = await db.ticket.findFirst({
      where: {
        OR: [
          { metadata: { path: ['source', 'jira', 'issueId'], equals: issueId } },
          { metadata: { path: ['source', 'jira', 'issueKey'], equals: issueKey } },
        ],
      },
      select: {
        id: true,
        conversationId: true,
        xyneId: true,
        title: true,
        description: true,
        createdBy: true,
        assignedTo: true,
        metadata: true,
      },
    });

    if (byId) {
      const metadata = (byId.metadata as Record<string, any> | null) || null;
      const cachedRecord: CachedTicketRecord = {
        id: byId.id,
        conversationId: byId.conversationId,
        xyneId: byId.xyneId,
        title: byId.title,
        description: byId.description,
        createdBy: byId.createdBy,
        assignedTo: byId.assignedTo,
        metadata,
      };
      this.cacheTicketRecord(cachedRecord, issueId, issueKey);
      return cachedRecord;
    }

    return null;
  }

  private async findExistingAttachment(entityId: string, attachmentId: string) {
    const cacheKey = this.buildAttachmentCacheKey(entityId, attachmentId);
    const cachedAttachment = this.existingAttachmentsByKey.get(cacheKey);
    if (cachedAttachment) {
      return cachedAttachment;
    }

    const existing = await db.messageAttachment.findFirst({
      where: {
        entityId,
        metadata: { path: ['source', 'jira', 'attachmentId'], equals: attachmentId },
      },
      select: {
        id: true,
        size: true,
        mimetype: true,
        url: true,
      },
    });

    if (existing) {
      this.existingAttachmentsByKey.set(cacheKey, existing);
    }

    return existing;
  }

  private async renderJiraMessageContent(
    body: unknown,
    unresolvedUsers: Map<string, { displayName: string | null; accountId: string | null; suggestedEmails: string[] }>,
    fallbackHtml: string,
  ): Promise<string> {
    const content = await adfToHtmlAsync(body, {
      resolveUserMention: async mention => {
        const resolvedMentionUserId = await this.userResolver.resolveUserOrNull(
          {
            accountId: mention.id,
            displayName: mention.displayName || mention.text,
          },
          unresolvedUsers,
        );

        if (!resolvedMentionUserId) {
          return null;
        }

        const username = (mention.displayName || mention.text || '').replace(/^@/, '').trim();
        return username
          ? { userId: resolvedMentionUserId, username }
          : null;
      },
    });

    return content.trim() || fallbackHtml;
  }

  private async importComments(
    issue: JiraIssue,
    conversationId: string,
    fallbackUserId: string,
    unresolvedUsers: Map<string, { displayName: string | null; accountId: string | null; suggestedEmails: string[] }>,
  ): Promise<{
    imported: number;
    skipped: number;
    lastCommentAt?: Date;
    commentMessageMap: Map<string, string>;
    comments: JiraComment[];
  }> {
    const comments = await this.jiraClient.fetchAllComments(issue.key);
    await this.preloadExistingCommentMessages(
      conversationId,
      comments.map(comment => comment.id),
    );
    let imported = 0;
    let skipped = 0;
    let lastCommentAt: Date | undefined;
    const commentMessageMap = new Map<string, string>();
    const participantJoinedAtByUserId = new Map<string, Date>();
    const messagesToCreate: Array<{
      messageId: string;
      conversationId: string;
      senderId: string;
      content: string;
      msgType: MessageType;
      hasAttachment: boolean;
      edited: boolean;
      isDeleted: boolean;
      showInChannel: boolean;
      visibleTo: null;
      createdAt: Date;
      metadata: any;
    }> = [];

    for (const comment of comments) {
      const cacheKey = this.buildCommentMessageCacheKey(conversationId, comment.id);
      const existingMessageId = this.existingCommentMessagesByKey.get(cacheKey);
      if (existingMessageId) {
        skipped += 1;
        commentMessageMap.set(comment.id, existingMessageId);
        continue;
      }

      const senderId = await this.userResolver.resolveUser(comment.author, fallbackUserId, unresolvedUsers);
      const createdAt = comment.created ? new Date(comment.created) : new Date();
      const content = await this.renderJiraMessageContent(
        comment.body,
        unresolvedUsers,
        '<p>[Imported Jira comment]</p>',
      );
      const messageId = randomUUID();

      messagesToCreate.push({
        messageId,
        conversationId,
        senderId,
        content,
        msgType: MessageType.USER,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        showInChannel: false,
        visibleTo: null,
        createdAt,
        metadata: {
          source: {
            system: 'jira',
            commentId: comment.id,
            issueId: issue.id,
            issueKey: issue.key,
            author: {
              accountId: comment.author?.accountId || null,
              displayName: comment.author?.displayName || null,
              emailAddress: comment.author?.emailAddress || null,
            },
          },
        },
      });
      commentMessageMap.set(comment.id, messageId);
      this.existingCommentMessagesByKey.set(cacheKey, messageId);

      const existingJoinedAt = participantJoinedAtByUserId.get(senderId);
      if (!existingJoinedAt || createdAt < existingJoinedAt) {
        participantJoinedAtByUserId.set(senderId, createdAt);
      }

      imported += 1;
      if (!lastCommentAt || createdAt > lastCommentAt) {
        lastCommentAt = createdAt;
      }
    }

    if (messagesToCreate.length > 0) {
      await db.message.createMany({
        data: messagesToCreate as any,
      });
      this.queueMessageVespaJobs(
        messagesToCreate.map(message => ({
          messageId: message.messageId,
          userId: message.senderId,
        })),
      );
    }

    if (participantJoinedAtByUserId.size > 0) {
      await db.conversationParticipant.createMany({
        data: Array.from(participantJoinedAtByUserId.entries()).map(([userId, joinedAt]) => ({
          id: randomUUID(),
          conversationId,
          userId,
          participationType: ConversationParticipation.AUTHOR,
          isSubscribed: true,
          joinedAt,
        })),
        skipDuplicates: true,
      });

      await db.conversationParticipant.updateMany({
        where: {
          conversationId,
          userId: { in: Array.from(participantJoinedAtByUserId.keys()) },
        },
        data: {
          participationType: ConversationParticipation.AUTHOR,
          isSubscribed: true,
        },
      });
    }

    if (comments.length > 0) {
      await db.conversation.update({
        where: { conversationId },
        data: {
          replyCount: comments.length,
          ...(lastCommentAt && { lastActivityAt: lastCommentAt }),
        },
      });
    }

    return { imported, skipped, lastCommentAt, commentMessageMap, comments };
  }

  private extractCommentMediaRefs(body: unknown): JiraCommentMediaRef[] {
    const refs: JiraCommentMediaRef[] = [];

    const visit = (node: any): void => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node !== 'object') return;

      if (node.type === 'media' && node.attrs?.type === 'file' && typeof node.attrs?.id === 'string') {
        refs.push({
          mediaId: node.attrs.id,
          width: typeof node.attrs.width === 'number' ? node.attrs.width : undefined,
          height: typeof node.attrs.height === 'number' ? node.attrs.height : undefined,
        });
      }

      if (Array.isArray(node.content)) {
        node.content.forEach(visit);
      }
    };

    visit(body);
    return refs;
  }

  private scoreCommentAttachmentCandidate(
    comment: JiraComment,
    mediaRef: JiraCommentMediaRef,
    attachment: JiraAttachment,
    remainingAttachmentCount: number,
    totalMediaRefCount: number,
  ): number {
    let score = 0;

    const normalizedCommentAuthor = normalizeComparableValue(comment.author?.displayName || comment.author?.emailAddress);
    const normalizedAttachmentAuthor = normalizeComparableValue(attachment.author?.displayName || attachment.author?.emailAddress);
    if (normalizedCommentAuthor && normalizedAttachmentAuthor && normalizedCommentAuthor === normalizedAttachmentAuthor) {
      score += 45;
    }

    const commentCreatedAt = comment.created ? new Date(comment.created).getTime() : null;
    const attachmentCreatedAt = attachment.created ? new Date(attachment.created).getTime() : null;
    if (commentCreatedAt && attachmentCreatedAt) {
      const diffMinutes = Math.abs(commentCreatedAt - attachmentCreatedAt) / 60000;
      if (diffMinutes <= 2) score += 35;
      else if (diffMinutes <= 10) score += 28;
      else if (diffMinutes <= 60) score += 18;
      else if (diffMinutes <= 24 * 60) score += 8;
    }

    const commentText = normalizeComparableValue(adfToText(comment.body));
    const filenameBase = normalizeComparableValue((attachment.filename || '').replace(/\.[^.]+$/, ''));
    if (commentText && filenameBase && commentText.includes(filenameBase)) {
      score += 20;
    }

    if (remainingAttachmentCount === 1) {
      score += 12;
    }

    if (totalMediaRefCount === 1) {
      score += 8;
    }

    if (mediaRef.width || mediaRef.height) {
      score += 2;
    }

    return score;
  }

  private buildCommentAttachmentPlan(
    issue: JiraIssue,
    comment: JiraComment,
    issueAttachments: JiraAttachment[],
  ): { matches: JiraCommentAttachmentMatch[]; warnings: string[] } {
    const mediaRefs = this.extractCommentMediaRefs(comment.body);
    if (mediaRefs.length === 0 || issueAttachments.length === 0) {
      return { matches: [], warnings: [] };
    }

    const matches: JiraCommentAttachmentMatch[] = [];
    const warnings: string[] = [];
    const unassignedAttachmentIds = new Set(issueAttachments.map(attachment => attachment.id));
    const SCORE_THRESHOLD = 55;
    const AMBIGUITY_GAP = 8;

    for (const mediaRef of mediaRefs) {
      const candidates = issueAttachments
        .filter(attachment => unassignedAttachmentIds.has(attachment.id))
        .map(attachment => ({
          attachment,
          score: this.scoreCommentAttachmentCandidate(
            comment,
            mediaRef,
            attachment,
            unassignedAttachmentIds.size,
            mediaRefs.length,
          ),
        }))
        .sort((left, right) => right.score - left.score);

      const best = candidates[0];
      const secondBest = candidates[1];

      if (!best || best.score < SCORE_THRESHOLD) {
        warnings.push(
          `Skipped ambiguous comment attachment mapping for ${issue.key} comment ${comment.id} media ${mediaRef.mediaId}: no candidate crossed score threshold`,
        );
        continue;
      }

      if (secondBest && best.score - secondBest.score < AMBIGUITY_GAP) {
        warnings.push(
          `Skipped ambiguous comment attachment mapping for ${issue.key} comment ${comment.id} media ${mediaRef.mediaId}: candidates ${best.attachment.id} and ${secondBest.attachment.id} scored too closely (${best.score} vs ${secondBest.score})`,
        );
        continue;
      }

      unassignedAttachmentIds.delete(best.attachment.id);
      matches.push({ mediaRef, attachment: best.attachment, score: best.score });
    }

    return { matches, warnings };
  }

  private async importCommentAttachments(
    issue: JiraIssue,
    conversationId: string,
    ticketId: string,
    comments: JiraComment[],
    commentMessageMap: Map<string, string>,
    fallbackUserId: string,
    unresolvedUsers: Map<string, { displayName: string | null; accountId: string | null; suggestedEmails: string[] }>,
  ): Promise<{ imported: number; skipped: number; warnings: string[] }> {
    const issueAttachments: JiraAttachment[] = Array.isArray(issue.fields.attachment)
      ? issue.fields.attachment
      : [];

    let imported = 0;
    let skipped = 0;
    const warnings: string[] = [];
    const messageIds = comments
      .map(comment => commentMessageMap.get(comment.id))
      .filter((messageId): messageId is string => Boolean(messageId));

    await this.preloadExistingAttachmentsForEntities(
      messageIds,
      issueAttachments.map(attachment => attachment.id),
    );

    const plannedMatches: Array<{
      messageId: string;
      commentId: string;
      mediaRef: JiraCommentMediaRef;
      attachment: JiraAttachment;
      score: number;
    }> = [];
    const seenMatchKeys = new Set<string>();

    for (const comment of comments) {
      const messageId = commentMessageMap.get(comment.id);
      if (!messageId) continue;

      const attachmentPlan = this.buildCommentAttachmentPlan(issue, comment, issueAttachments);
      warnings.push(...attachmentPlan.warnings);
      if (attachmentPlan.matches.length === 0) continue;

      for (const { mediaRef, attachment, score } of attachmentPlan.matches) {
        const matchKey = `${messageId}:${attachment.id}`;
        if (seenMatchKeys.has(matchKey)) {
          continue;
        }

        seenMatchKeys.add(matchKey);
        plannedMatches.push({
          messageId,
          commentId: comment.id,
          mediaRef,
          attachment,
          score,
        });
      }
    }

    const downloadCache = new Map<
      string,
      Promise<{ gcsPath: string; size: number; filename: string; mimeType: string }>
    >();
    const getDownloadedAttachment = (
      attachment: JiraAttachment,
    ): Promise<{ gcsPath: string; size: number; filename: string; mimeType: string }> => {
      const cachedDownload = downloadCache.get(attachment.id);
      if (cachedDownload) {
        return cachedDownload;
      }

      const downloadPromise = this.jiraClient.downloadAttachment(attachment, issue.key);
      downloadCache.set(attachment.id, downloadPromise);
      return downloadPromise;
    };

    const attachmentResults = await mapWithConcurrency(
      plannedMatches,
      ATTACHMENT_IMPORT_CONCURRENCY,
      async plannedMatch => {
        const existing = await this.findExistingAttachment(plannedMatch.messageId, plannedMatch.attachment.id);
        if (existing) {
          return { status: 'skipped' as const, messageId: plannedMatch.messageId };
        }

        const ticketLevelAttachment = await this.findExistingAttachment(ticketId, plannedMatch.attachment.id);
        const attachmentData = ticketLevelAttachment
          ? {
              size: ticketLevelAttachment.size,
              mimeType: ticketLevelAttachment.mimetype,
              url: ticketLevelAttachment.url,
            }
          : await (async () => {
              const downloaded = await getDownloadedAttachment(plannedMatch.attachment);
              return {
                size: downloaded.size,
                mimeType: downloaded.mimeType,
                url: downloaded.gcsPath,
              };
            })();

        const uploadedBy = await this.userResolver.resolveUser(
          plannedMatch.attachment.author,
          fallbackUserId,
          unresolvedUsers,
        );

        const createdAttachment = await db.messageAttachment.create({
          data: {
            entityId: plannedMatch.messageId,
            entityType: AttachmentEntityType.CHAT,
            originalFilename: plannedMatch.attachment.filename,
            size: attachmentData.size,
            mimetype: attachmentData.mimeType,
            url: attachmentData.url,
            uploadedByUserId: uploadedBy,
            createdBy: uploadedBy,
            storageProvider: config.fileStorage.provider,
            conversationId,
            width: plannedMatch.mediaRef.width,
            height: plannedMatch.mediaRef.height,
            createdAt: plannedMatch.attachment.created ? new Date(plannedMatch.attachment.created) : new Date(),
            metadata: {
              source: {
                system: 'jira',
                attachmentId: plannedMatch.attachment.id,
                issueId: issue.id,
                issueKey: issue.key,
                commentId: plannedMatch.commentId,
                mediaId: plannedMatch.mediaRef.mediaId,
                matchScore: plannedMatch.score,
                originalContentUrl: plannedMatch.attachment.content || null,
              },
            },
          },
        });

        this.existingAttachmentsByKey.set(
          this.buildAttachmentCacheKey(plannedMatch.messageId, plannedMatch.attachment.id),
          {
            id: createdAttachment.id,
            size: createdAttachment.size,
            mimetype: createdAttachment.mimetype,
            url: createdAttachment.url,
          },
        );
        queueJiraImportAttachmentVespaJob(createdAttachment.id, uploadedBy);

        return { status: 'imported' as const, messageId: plannedMatch.messageId };
      },
    );

    const messageIdsWithImportedAttachments = new Set<string>();
    for (const result of attachmentResults) {
      if (result.status === 'imported') {
        imported += 1;
        messageIdsWithImportedAttachments.add(result.messageId);
      } else {
        skipped += 1;
      }
    }

    await Promise.all(
      Array.from(messageIdsWithImportedAttachments).map(messageId =>
        db.message.update({
          where: { messageId },
          data: { hasAttachment: true },
        }),
      ),
    );

    return { imported, skipped, warnings };
  }

  private async importAttachments(
    issue: JiraIssue,
    ticketId: string,
    conversationId: string,
    fallbackUserId: string,
    unresolvedUsers: Map<string, { displayName: string | null; accountId: string | null; suggestedEmails: string[] }>,
  ): Promise<{ imported: number; skipped: number }> {
    const attachments: JiraAttachment[] = Array.isArray(issue.fields.attachment)
      ? issue.fields.attachment
      : [];

    await this.preloadExistingAttachments(
      ticketId,
      attachments.map(attachment => attachment.id),
    );

    let imported = 0;
    let skipped = 0;
    const attachmentsToCreate: Array<{
      attachmentId: string;
      entityId: string;
      entityType: AttachmentEntityType;
      originalFilename: string;
      size: number;
      mimetype: string;
      url: string;
      uploadedByUserId: string;
      createdBy: string;
      storageProvider: string;
      conversationId: string;
      createdAt: Date;
      metadata: {
        source: {
          system: 'jira';
          attachmentId: string;
          issueId: string;
          issueKey: string;
          originalContentUrl: string | null;
        };
      };
    }> = [];
    const attachmentsToImport: JiraAttachment[] = [];

    for (const attachment of attachments) {
      const existing = await this.findExistingAttachment(ticketId, attachment.id);
      if (existing) {
        skipped += 1;
        continue;
      }

      attachmentsToImport.push(attachment);
    }

    const preparedAttachments = await mapWithConcurrency(
      attachmentsToImport,
      ATTACHMENT_IMPORT_CONCURRENCY,
      async attachment => {
        const uploadedBy = await this.userResolver.resolveUser(attachment.author, fallbackUserId, unresolvedUsers);
        const downloaded = await this.jiraClient.downloadAttachment(attachment, issue.key);

        return {
          attachmentId: attachment.id,
          entityId: ticketId,
          entityType: AttachmentEntityType.TICKET,
          originalFilename: attachment.filename,
          size: downloaded.size,
          mimetype: downloaded.mimeType,
          url: downloaded.gcsPath,
          uploadedByUserId: uploadedBy,
          createdBy: uploadedBy,
          storageProvider: config.fileStorage.provider,
          conversationId,
          createdAt: attachment.created ? new Date(attachment.created) : new Date(),
          metadata: {
            source: {
              system: 'jira' as const,
              attachmentId: attachment.id,
              issueId: issue.id,
              issueKey: issue.key,
              originalContentUrl: attachment.content || null,
            },
          },
        };
      },
    );

    attachmentsToCreate.push(...preparedAttachments);

    if (attachmentsToCreate.length > 0) {
      await db.messageAttachment.createMany({
        data: attachmentsToCreate.map(({ attachmentId: _attachmentId, ...attachmentData }) => attachmentData),
        skipDuplicates: true,
      });
      await this.preloadExistingAttachments(
        ticketId,
        attachmentsToCreate.map(attachment => attachment.attachmentId),
      );
      this.queueAttachmentVespaJobs(
        attachmentsToCreate.flatMap(attachment => {
          const existing = this.existingAttachmentsByKey.get(this.buildAttachmentCacheKey(ticketId, attachment.attachmentId));
          return existing
            ? [{ attachmentId: existing.id, userId: attachment.uploadedByUserId }]
            : [];
        }),
      );
      imported += attachmentsToCreate.length;
    }

    return { imported, skipped };
  }

  private mapJiraIssueLinkRelation(link: JiraIssueLink): {
    targetIssue: { id: string; key: string } | null;
    relationType: TicketReferenceRelation;
    jiraDirection: 'inward' | 'outward' | 'unknown';
    jiraLabel: string | null;
    jiraTypeName: string | null;
  } {
    const linkedIssue = link.outwardIssue || link.inwardIssue || null;
    const jiraDirection = link.outwardIssue
      ? 'outward'
      : link.inwardIssue
        ? 'inward'
        : 'unknown';
    const jiraLabel =
      jiraDirection === 'outward'
        ? link.type?.outward || link.type?.name || null
        : jiraDirection === 'inward'
          ? link.type?.inward || link.type?.name || null
          : link.type?.name || null;
    const normalizedLabel = normalizeComparableValue(jiraLabel);
    const normalizedTypeName = normalizeComparableValue(link.type?.name || '');
    const duplicateHints = [normalizedLabel, normalizedTypeName].filter(Boolean);

    let relationType: TicketReferenceRelation = TicketReferenceRelation.LINKED;
    if (
      duplicateHints.some(
        value =>
          value.includes('duplicate') ||
          value.includes('duplicated') ||
          value.includes('isduplicatedby') ||
          value.includes('duplicates'),
      )
    ) {
      relationType = TicketReferenceRelation.DUPLICATE_CONFIRMED;
    } else if (
      duplicateHints.some(
        value => value.includes('similar') || value.includes('possibleduplicate') || value.includes('relatedduplicate'),
      )
    ) {
      relationType = TicketReferenceRelation.DUPLICATE_POSSIBLE;
    }

    return {
      targetIssue: linkedIssue,
      relationType,
      jiraDirection,
      jiraLabel,
      jiraTypeName: link.type?.name || null,
    };
  }

  private async importRelationships(
    issues: JiraIssue[],
    actorUserId: string,
    jiraProjectKey: string,
  ): Promise<number> {
    const relationshipCandidates: Array<{
      sourceTicketId: string;
      targetTicketId: string;
      relationType: TicketReferenceRelation;
      activityValue: Record<string, any>;
    }> = [];

    for (const issue of issues) {
      const sourceTicket = await this.findExistingTicketByJiraId(issue.id, issue.key);
      if (!sourceTicket) continue;

      const issueLinks: JiraIssueLink[] = Array.isArray(issue.fields.issuelinks)
        ? issue.fields.issuelinks
        : [];

      for (const link of issueLinks) {
        const mappedLink = this.mapJiraIssueLinkRelation(link);
        if (!mappedLink.targetIssue) continue;

        const targetTicket = await this.findExistingTicketByJiraId(
          mappedLink.targetIssue.id,
          mappedLink.targetIssue.key,
        );
        if (!targetTicket || targetTicket.id === sourceTicket.id) continue;

        relationshipCandidates.push({
          sourceTicketId: sourceTicket.id,
          targetTicketId: targetTicket.id,
          relationType: mappedLink.relationType,
          activityValue: {
            action: 'imported_from_jira',
            relationType: mappedLink.relationType,
            targetTicketId: targetTicket.id,
            targetTicketTitle: targetTicket.title,
            targetTicketXyneId: targetTicket.xyneId,
            jiraLinkTypeName: mappedLink.jiraTypeName,
            jiraLinkLabel: mappedLink.jiraLabel,
            jiraDirection: mappedLink.jiraDirection,
            jiraLinkId: link.id || null,
            jiraSourceIssueId: issue.id,
            jiraSourceIssueKey: issue.key,
            jiraTargetIssueId: mappedLink.targetIssue.id,
            jiraTargetIssueKey: mappedLink.targetIssue.key,
          },
        });
      }
    }

    if (relationshipCandidates.length === 0) {
      logger.info(`${buildJiraMigrationProjectLogPrefix(jiraProjectKey)} Relationship import completed`, {
        linkedTickets: 0,
        totalIssues: issues.length,
      });
      return 0;
    }

    const sourceTicketIds = [...new Set(relationshipCandidates.map(candidate => candidate.sourceTicketId))];
    const targetTicketIds = [...new Set(relationshipCandidates.map(candidate => candidate.targetTicketId))];
    const relationTypes = [...new Set(relationshipCandidates.map(candidate => candidate.relationType))];

    const existingMappings = await db.ticketReferenceMapping.findMany({
      where: {
        sourceTicketId: { in: sourceTicketIds },
        targetTicketId: { in: targetTicketIds },
        relationType: { in: relationTypes },
      },
      select: {
        sourceTicketId: true,
        targetTicketId: true,
        relationType: true,
      },
    });

    const existingMappingKeys = new Set(
      existingMappings.map(mapping => `${mapping.sourceTicketId}:${mapping.targetTicketId}:${mapping.relationType}`),
    );
    const seenMappingKeys = new Set<string>();
    const mappingsToCreate: Array<{
      sourceTicketId: string;
      targetTicketId: string;
      relationType: TicketReferenceRelation;
      createdBy: string;
    }> = [];
    const activitiesToCreate: Array<{
      ticketId: string;
      updatedBy: string;
      activityType: ActivityType;
      value: Record<string, any>;
    }> = [];

    for (const candidate of relationshipCandidates) {
      const mappingKey = `${candidate.sourceTicketId}:${candidate.targetTicketId}:${candidate.relationType}`;
      if (existingMappingKeys.has(mappingKey) || seenMappingKeys.has(mappingKey)) {
        continue;
      }

      seenMappingKeys.add(mappingKey);
      mappingsToCreate.push({
        sourceTicketId: candidate.sourceTicketId,
        targetTicketId: candidate.targetTicketId,
        relationType: candidate.relationType,
        createdBy: actorUserId,
      });
      activitiesToCreate.push({
        ticketId: candidate.sourceTicketId,
        updatedBy: actorUserId,
        activityType: ActivityType.REFERENCE_TICKET,
        value: candidate.activityValue,
      });
    }

    if (mappingsToCreate.length > 0) {
      await db.ticketReferenceMapping.createMany({
        data: mappingsToCreate,
        skipDuplicates: true,
      });
    }

    if (activitiesToCreate.length > 0) {
      await db.ticketActivity.createMany({
        data: activitiesToCreate as any,
      });
    }

    logger.info(`${buildJiraMigrationProjectLogPrefix(jiraProjectKey)} Relationship import completed`, {
      linkedTickets: mappingsToCreate.length,
      totalIssues: issues.length,
    });

    return mappingsToCreate.length;
  }

  private async createSubTicketMappings(
    issues: JiraIssue[],
    actorUserId: string,
    fieldDefinitions: JiraFieldDefinition[],
    jiraProjectKey: string,
  ): Promise<number> {
    let createdSubTickets = 0;
    const seenMappingKeys = new Set<string>();
    const mappingsToCreate: Array<{ ticketId: string; subTicketId: string }> = [];
    const activitiesToCreate: Array<{
      ticketId: string;
      updatedBy: string;
      activityType: ActivityType;
      value: Record<string, any>;
    }> = [];

    for (const issue of issues) {
      const issueLogPrefix = buildJiraMigrationIssueLogPrefix(jiraProjectKey, issue);
      const parentIssueKey = resolveJiraParentIssueKey(issue, fieldDefinitions);
      if (!parentIssueKey) continue;

      const childTicket = await this.findExistingTicketByJiraId(issue.id, issue.key);
      if (!childTicket) continue;

      const parentTicket = await db.ticket.findFirst({
        where: {
          OR: [
            { metadata: { path: ['source', 'jira', 'issueKey'], equals: parentIssueKey } },
          ],
        },
      });

      if (!parentTicket) {
        logger.warn(`${issueLogPrefix} Parent ticket not found for Jira parent-child mapping`, {
          issueKey: issue.key,
          parentIssueKey,
        });
        continue;
      }

      const existingSubTicket = await db.subTicket.findFirst({
        where: {
          mappedTicketId: childTicket.id,
        },
      });

      if (existingSubTicket) {
        const existingMapping = await db.ticketSubTicketMapping.findFirst({
          where: {
            ticketId: parentTicket.id,
            subTicketId: existingSubTicket.id,
          },
        });

        const mappingKey = `${parentTicket.id}:${existingSubTicket.id}`;
        if (!existingMapping && !seenMappingKeys.has(mappingKey)) {
          seenMappingKeys.add(mappingKey);
          mappingsToCreate.push({
            ticketId: parentTicket.id,
            subTicketId: existingSubTicket.id,
          });
        }
        continue;
      }

      const subTicket = await db.subTicket.create({
        data: {
          title: childTicket.title,
          description: childTicket.description || null,
          mappedTicketId: childTicket.id,
          createdBy: childTicket.createdBy,
          updatedBy: actorUserId,
          conversationId: childTicket.conversationId,
          assignedTo: childTicket.assignedTo || null,
        },
      });

      const mappingKey = `${parentTicket.id}:${subTicket.id}`;
      if (!seenMappingKeys.has(mappingKey)) {
        seenMappingKeys.add(mappingKey);
        mappingsToCreate.push({
          ticketId: parentTicket.id,
          subTicketId: subTicket.id,
        });
      }

      activitiesToCreate.push({
        ticketId: parentTicket.id,
        updatedBy: actorUserId,
        activityType: ActivityType.SUBTICKET_CREATED,
        value: {
          subTicketId: subTicket.id,
          subTicketTitle: subTicket.title,
          jiraIssueKey: issue.key,
          mappedTicketId: childTicket.id,
          mappedTicketXyneId: childTicket.xyneId,
        },
      });

      createdSubTickets += 1;
    }

    if (mappingsToCreate.length > 0) {
      await db.ticketSubTicketMapping.createMany({
        data: mappingsToCreate,
      });
    }

    if (activitiesToCreate.length > 0) {
      await db.ticketActivity.createMany({
        data: activitiesToCreate as any,
      });
    }

    return createdSubTickets;
  }

  private async ensureExternalSource(
    jiraProjectKey: string,
    channelId: string,
    boardId: string,
  ): Promise<{ externalSourceId: string; created: boolean }> {
    const externalSourceName = `jira-${jiraProjectKey}-${channelId}`.toLowerCase();
    const existingSource = await this.externalSourceRepository.findByName(externalSourceName);

    if (existingSource) {
      await this.externalSourceRepository.update(existingSource.id, {
        displayName: `Jira (${jiraProjectKey})`,
        channelId,
        boardId,
        isActive: true,
      });
      return {
        externalSourceId: existingSource.id,
        created: false,
      };
    }

    const createdSource = await this.externalSourceRepository.create({
      name: externalSourceName,
      sourceType: 'jira',
      displayName: `Jira (${jiraProjectKey})`,
      channelId,
      boardId,
      credentials: encrypt(
        JSON.stringify({
          baseUrl: config.jira.baseUrl,
          projectKey: jiraProjectKey,
        }),
      ),
    });

    return {
      externalSourceId: createdSource.id,
      created: true,
    };
  }

  private async flushPendingExternalTicketMappings(): Promise<void> {
    if (this.pendingExternalTicketMappings.length === 0) {
      return;
    }

    const pendingMappings = this.pendingExternalTicketMappings;
    this.pendingExternalTicketMappings = [];

    await db.externalMessage.createMany({
      data: pendingMappings.map(mapping => ({
        externalSourceId: mapping.externalSourceId,
        externalId: mapping.externalId,
        externalThreadId: mapping.externalThreadId,
        messageId: mapping.entityId,
        entityId: mapping.entityId,
        direction: mapping.direction,
        entityType: mapping.entityType,
      })),
      skipDuplicates: true,
    });
  }

  private async ensureTicketExternalMapping(
    externalSourceId: string,
    issue: JiraIssue,
    ticketId: string,
  ): Promise<void> {
    if (this.existingExternalTicketMappings.has(issue.id)) {
      return;
    }

    this.pendingExternalTicketMappings.push({
      externalSourceId,
      externalId: issue.id,
      externalThreadId: issue.key,
      entityId: ticketId,
      direction: MessageDirection.INCOMING,
      entityType: ExternalEntityType.TICKET,
    });
    this.existingExternalTicketMappings.add(issue.id);

    if (this.pendingExternalTicketMappings.length >= 25) {
      await this.flushPendingExternalTicketMappings();
    }
  }

  async execute(
    input: JiraMigrationExecuteInput,
    actorUserId: string,
    onProgress?: (update: JiraMigrationProgressUpdate) => Promise<void> | void,
  ): Promise<JiraMigrationExecuteResult> {
    this.resetExecutionCaches();
    const jiraProjectKey = input.jiraProjectKey.trim().toUpperCase();
    const warnings: string[] = [];
    const unresolvedUsers = new Map<
      string,
      { displayName: string | null; accountId: string | null; suggestedEmails: string[] }
    >();

    logger.info(`${buildJiraMigrationProjectLogPrefix(jiraProjectKey)} Migration started`, {
      targetProjectId: input.targetProjectId,
      targetBoardId: input.targetBoardId,
      targetChannelId: input.targetChannelId,
      issueKeysCount: input.issueKeys?.length || 0,
      dateFrom: input.dateFrom || null,
    });

    const [project, board, channel, initialStages, fieldDefinitions] = await Promise.all([
      db.project.findUnique({ where: { id: input.targetProjectId } }),
      db.board.findUnique({ where: { id: input.targetBoardId } }),
      db.channel.findUnique({ where: { id: input.targetChannelId } }),
      db.stage.findMany({
        where: { boardId: input.targetBoardId },
        orderBy: { sequenceNumber: 'asc' },
        select: {
          id: true,
          name: true,
          sequenceNumber: true,
          defaultTicketStatusV2: true,
        },
      }),
      this.jiraClient.fetchFieldDefinitions(),
    ]);

    if (!project) throw new Error('Target project not found');
    if (!board) throw new Error('Target board not found');
    if (!channel) throw new Error('Target channel not found');
    if (initialStages.length === 0) throw new Error('Target board has no stages');
    if (board.projectId !== project.id) throw new Error('Board does not belong to target project');
    if (channel.projectId !== project.id) throw new Error('Channel does not belong to target project');

    const parentFieldIds = fieldDefinitions
      .filter(field => {
        const normalizedName = normalize(field.name || '');
        const normalizedCustom = normalize(field.schema?.custom || '');
        return (
          normalizedName === 'epiclink' ||
          normalizedName === 'epic_link' ||
          normalizedName === 'epiclinkdeprecated' ||
          normalizedCustom.includes('epiclink')
        );
      })
      .map(field => field.id);

    const {
      externalSourceId,
      created: externalSourceCreated,
    } = await this.ensureExternalSource(jiraProjectKey, channel.id, board.id);

    await this.userResolver.warmUserResolutionLookup();

    let stages: JiraStageSummary[] = [...initialStages];
    const fieldMap = new Map<string, { fieldId: string; fieldType: string }>();
    let createdCount = 0;
    let reusedCount = 0;
    let totalIssues = 0;
    let processedIssues = 0;
    let importedTickets = 0;
    let skippedTickets = 0;
    let importedComments = 0;
    let skippedComments = 0;
    let importedAttachments = 0;
    let skippedAttachments = 0;
    let initialProgressPublished = false;
    const issueResults: JiraMigrationIssueResult[] = [];
    const relationshipIssues: JiraIssue[] = [];

    const publishProgress = async (
      currentIssueKey: string | null,
      currentStep: string | null,
      issueResult?: JiraMigrationIssueResult,
    ): Promise<void> => {
      if (!onProgress) return;

      await onProgress({
        totalIssues,
        processedIssues,
        importedTickets,
        skippedTickets,
        importedComments,
        skippedComments,
        importedAttachments,
        skippedAttachments,
        currentIssueKey,
        currentStep,
        warnings: [...warnings],
        ...(issueResult ? { issueResult } : {}),
      });
    };

    const ensureInitialProgress = async (): Promise<void> => {
      if (initialProgressPublished) return;
      initialProgressPublished = true;
      await publishProgress(null, 'starting');
    };

    const processIssuesChunk = async (issuesChunk: JiraIssue[]): Promise<void> => {
      if (issuesChunk.length === 0) {
        return;
      }

      relationshipIssues.push(
        ...issuesChunk.map(issue => this.buildIssueRelationshipSnapshot(issue, parentFieldIds)),
      );

      await this.preloadExistingTickets(issuesChunk);
      stages = await this.ensureExactJiraStages(board.id, actorUserId, issuesChunk, stages);

      const incrementalFieldSetup = await this.ensureBoardCustomFieldsIncremental(
        board.id,
        board.name,
        actorUserId,
        fieldDefinitions,
        issuesChunk,
        fieldMap,
      );
      createdCount += incrementalFieldSetup.createdCount;
      reusedCount += incrementalFieldSetup.reusedCount;
      for (const [jiraFieldId, mapping] of incrementalFieldSetup.fieldMap.entries()) {
        fieldMap.set(jiraFieldId, mapping);
      }

      const pageTicketIds = [
        ...new Set(
          issuesChunk
            .map(issue => this.getCachedTicketRecord(issue.id, issue.key)?.id)
            .filter((ticketId): ticketId is string => Boolean(ticketId)),
        ),
      ];
      const currentFieldIds = [...new Set(Array.from(fieldMap.values()).map(mapping => mapping.fieldId))];

      await Promise.all([
        this.preloadExistingExternalMappings(externalSourceId, issuesChunk),
        this.preloadExistingFormValues(pageTicketIds, currentFieldIds, board.id),
      ]);

      await ensureInitialProgress();

      for (const issue of issuesChunk) {
        const existingTicket = await this.findExistingTicketByJiraId(issue.id, issue.key);
        let ticketId = existingTicket?.id;
        let conversationId = existingTicket?.conversationId;

        const reporter = issue.fields.reporter as JiraUser | undefined;
        const assignee = issue.fields.assignee as JiraUser | undefined;
        const statusName = issue.fields.status?.name || 'Open';
        const summary = issue.fields.summary || issue.key;
        const description = adfToText(issue.fields.description).trim() || `[Imported from Jira ${issue.key}]`;
        const rootMessageContent = await this.renderJiraMessageContent(
          issue.fields.description,
          unresolvedUsers,
          `<p>[Imported from Jira ${issue.key}]</p>`,
        );
        const createdAt = issue.fields.created ? new Date(issue.fields.created) : new Date();
        const issueResult: JiraMigrationIssueResult = {
          issueKey: issue.key,
          summary,
          status: 'completed',
          failedStep: null,
          errors: [],
        };
        const issueLogPrefix = buildJiraMigrationIssueLogPrefix(jiraProjectKey, issue);

        try {
          const resolvedReporterId = await this.userResolver.resolveUser(reporter, actorUserId, unresolvedUsers);
          const resolvedAssigneeId = await this.userResolver.resolveUser(assignee, actorUserId, unresolvedUsers);
          const stageMatch = inferStatusMatch(statusName, stages);
          let initialMessageIdForTicket: string | null = null;

          if (!existingTicket) {
            const generatedConversationId = randomUUID();
            const initialMessageId = randomUUID();
            initialMessageIdForTicket = initialMessageId;

            const ticket = await db.$transaction(async tx => {
              await tx.conversation.create({
                data: {
                  conversationId: generatedConversationId,
                  channelId: channel.id,
                  createdBy: resolvedReporterId,
                  initialMessageId,
                  createdAt,
                  lastActivityAt: createdAt,
                },
              });

              await tx.message.create({
                data: {
                  messageId: initialMessageId,
                  conversationId: generatedConversationId,
                  senderId: resolvedReporterId,
                  content: rootMessageContent,
                  msgType: MessageType.USER,
                  hasAttachment: false,
                  edited: false,
                  isDeleted: false,
                  showInChannel: false,
                  visibleTo: null,
                  createdAt,
                  metadata: ({
                    source: {
                      system: 'jira',
                      issueId: issue.id,
                      issueKey: issue.key,
                      importedRootMessage: true,
                    },
                  }) as any,
                },
              });

              await tx.conversationParticipant.upsert({
                where: {
                  conversationId_userId: {
                    conversationId: generatedConversationId,
                    userId: resolvedReporterId,
                  },
                },
                create: {
                  id: randomUUID(),
                  conversationId: generatedConversationId,
                  userId: resolvedReporterId,
                  participationType: ConversationParticipation.AUTHOR,
                  isSubscribed: true,
                  joinedAt: createdAt,
                },
                update: {
                  participationType: ConversationParticipation.AUTHOR,
                  isSubscribed: true,
                },
              });

              const xyneId = await TicketIdService.generateTicketId(tx as any, project.id);

              const createdTicket = await this.ticketRepository.createTicket(
                {
                  title: summary,
                  description,
                  createdBy: resolvedReporterId,
                  updatedBy: actorUserId,
                  assignedTo: assignee ? resolvedAssigneeId : undefined,
                  conversationId: generatedConversationId,
                  channelId: channel.id,
                  projectId: project.id,
                  boardId: board.id,
                  statusV2: stageMatch.statusV2,
                  priority: mapPriority(issue.fields.priority?.name),
                  xyneId,
                  ticketType: issue.fields.issuetype?.name || undefined,
                  stageName: stageMatch.stageName,
                  createdAt: createdAt.toISOString(),
                  metadata: {
                    source: {
                      system: 'jira',
                      site: config.jira.baseUrl,
                      issueId: issue.id,
                      issueKey: issue.key,
                      projectKey: jiraProjectKey,
                      originalStatus: statusName,
                      originalIssueType: issue.fields.issuetype?.name || null,
                      reporter: {
                        accountId: reporter?.accountId || null,
                        displayName: reporter?.displayName || null,
                        emailAddress: reporter?.emailAddress || null,
                      },
                      assignee: {
                        accountId: assignee?.accountId || null,
                        displayName: assignee?.displayName || null,
                        emailAddress: assignee?.emailAddress || null,
                      },
                    },
                    jira: {
                      parentKey: resolveJiraParentIssueKey(issue, fieldDefinitions),
                      resolution: issue.fields.resolution?.name || null,
                      resolutionDate: issue.fields.resolutiondate || null,
                    },
                  },
                },
                tx as any,
              );

              const ticketMd = serializeTicketMd({
                id: createdTicket.id,
                title: createdTicket.title,
                description: createdTicket.description,
                statusV2: createdTicket.statusV2 as TicketCardSummary['statusV2'],
                priority: createdTicket.priority as TicketCardSummary['priority'],
                assignedTo: createdTicket.assignedTo ?? null,
                createdBy: createdTicket.createdBy,
                createdAt: createdTicket.createdAt.getTime(),
                eta: createdTicket.eta ? createdTicket.eta.getTime() : null,
                xyneId: createdTicket.xyneId,
                stageName: createdTicket.stageName,
                ticketType: createdTicket.ticketType ?? null,
                channelId: createdTicket.channelId,
                conversationId: createdTicket.conversationId,
              });

              await tx.conversation.update({
                where: { conversationId: generatedConversationId },
                data: {
                  ticketId: createdTicket.id,
                  ticket_md: ticketMd,
                },
              });

              return createdTicket;
            });

            ticketId = ticket.id;
            conversationId = generatedConversationId;
            this.cacheTicketRecord(
              {
                id: ticket.id,
                conversationId: generatedConversationId,
                xyneId: ticket.xyneId,
                title: ticket.title,
                description: ticket.description,
                createdBy: ticket.createdBy,
                assignedTo: ticket.assignedTo,
                metadata: ticket.metadata,
              },
              issue.id,
              issue.key,
            );

            const createdTicketId = ticket.id;
            if (Array.isArray(issue.fields.labels) && issue.fields.labels.length > 0) {
              const uniqueLabels = [...new Set((issue.fields.labels as string[]).filter(Boolean))];
              if (uniqueLabels.length > 0) {
                await db.ticketTag.createMany({
                  data: uniqueLabels.map(name => ({
                    ticketId: createdTicketId,
                    name,
                  })),
                  skipDuplicates: true,
                });
              }
            }

            importedTickets += 1;
            this.queueTicketVespaJob(ticket.id, resolvedReporterId);

            if (initialMessageIdForTicket) {
              this.queueMessageVespaJobs([
                {
                  messageId: initialMessageIdForTicket,
                  userId: resolvedReporterId,
                },
              ]);
            }

          } else {
            skippedTickets += 1;
          }

          if (!ticketId || !conversationId) {
            const message = `Skipping issue ${issue.key}: ticket or conversation could not be resolved`;
            warnings.push(message);
            issueResult.status = 'failed';
            issueResult.failedStep = 'ticket_resolution';
            issueResult.errors.push(message);
            issueResults.push(issueResult);
            processedIssues += 1;
            await publishProgress(issue.key, 'ticket_resolution', issueResult);
            logger.error(`${issueLogPrefix} Ticket or conversation resolution failed`, {
              issueKey: issue.key,
              failedStep: issueResult.failedStep,
              status: issueResult.status,
              error: message,
            });
            continue;
          }

          try {
            await this.ensureTicketExternalMapping(externalSourceId, issue, ticketId);
          } catch (error) {
            const message = `External ticket mapping failed for ${issue.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            warnings.push(message);
            issueResult.status = 'partial';
            issueResult.failedStep = issueResult.failedStep || 'external_mapping';
            issueResult.errors.push(message);
            logger.error(`${issueLogPrefix} External ticket mapping failed`, {
              issueKey: issue.key,
              failedStep: issueResult.failedStep,
              status: issueResult.status,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }

          const formEntityValuesData: Array<{
            entityId: string;
            entityType: FormEntityType;
            fieldId: string;
            contextId: string;
            fieldValue: string;
            actualFieldValue: any;
          }> = [];

          for (const [jiraFieldId, mapping] of fieldMap.entries()) {
            const value = await this.normalizeFormValue(
              issue.fields[jiraFieldId],
              mapping.fieldType,
              actorUserId,
              unresolvedUsers,
            );

            if (
              value === null ||
              value === undefined ||
              (typeof value === 'string' && value.trim() === '') ||
              (Array.isArray(value) && value.length === 0)
            ) {
              continue;
            }

            formEntityValuesData.push({
              entityId: ticketId,
              entityType: FormEntityType.TICKET,
              fieldId: mapping.fieldId,
              contextId: board.id,
              fieldValue: '',
              actualFieldValue: value,
            });
          }

          try {
            if (!existingTicket) {
              if (formEntityValuesData.length > 0) {
                await db.formEntityValues.createMany({
                  data: formEntityValuesData,
                  skipDuplicates: true,
                });

                await this.preloadExistingFormValues(
                  [ticketId],
                  [...new Set(formEntityValuesData.map(formValue => formValue.fieldId))],
                  board.id,
                );
              }
            } else {
              for (const formValue of formEntityValuesData) {
                const formValueCacheKey = this.buildFormValueCacheKey(
                  formValue.entityId,
                  formValue.fieldId,
                  formValue.contextId,
                );
                const existingValueId = this.existingFormValuesByKey.get(formValueCacheKey);

                if (existingValueId) {
                  await db.formEntityValues.update({
                    where: { id: existingValueId },
                    data: {
                      actualFieldValue: formValue.actualFieldValue,
                    },
                  });
                } else {
                  try {
                    const createdFormValue = await db.formEntityValues.create({ data: formValue });
                    this.existingFormValuesByKey.set(formValueCacheKey, createdFormValue.id);
                  } catch (error) {
                    const isUniqueViolation =
                      typeof error === 'object' &&
                      error !== null &&
                      'code' in error &&
                      (error as { code?: string }).code === 'P2002';

                    if (!isUniqueViolation) {
                      throw error;
                    }

                    const existingValue = await db.formEntityValues.findFirst({
                      where: {
                        entityId: formValue.entityId,
                        entityType: formValue.entityType,
                        fieldId: formValue.fieldId,
                        contextId: formValue.contextId,
                      },
                    });

                    if (!existingValue) {
                      throw error;
                    }

                    this.existingFormValuesByKey.set(formValueCacheKey, existingValue.id);
                    await db.formEntityValues.update({
                      where: { id: existingValue.id },
                      data: {
                        actualFieldValue: formValue.actualFieldValue,
                      },
                    });
                  }
                }
              }
            }
          } catch (error) {
            const message = `Form field import failed for ${issue.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            warnings.push(message);
            issueResult.status = 'partial';
            issueResult.failedStep = issueResult.failedStep || 'form_values';
            issueResult.errors.push(message);
            logger.error(`${issueLogPrefix} Form field import failed`, {
              issueKey: issue.key,
              failedStep: issueResult.failedStep,
              status: issueResult.status,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }

          let importedCommentData:
            | {
                commentMessageMap: Map<string, string>;
                comments: JiraComment[];
              }
            | undefined;

          try {
            const commentResult = await this.importComments(issue, conversationId, actorUserId, unresolvedUsers);
            importedComments += commentResult.imported;
            skippedComments += commentResult.skipped;
            importedCommentData = {
              commentMessageMap: commentResult.commentMessageMap,
              comments: commentResult.comments,
            };
          } catch (error) {
            const message = `Comment import failed for ${issue.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            warnings.push(message);
            issueResult.status = 'partial';
            issueResult.failedStep = issueResult.failedStep || 'comments';
            issueResult.errors.push(message);
            logger.error(`${issueLogPrefix} Comment import failed`, {
              issueKey: issue.key,
              failedStep: issueResult.failedStep,
              status: issueResult.status,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }

          try {
            const attachmentResult = await this.importAttachments(
              issue,
              ticketId,
              conversationId,
              actorUserId,
              unresolvedUsers,
            );
            importedAttachments += attachmentResult.imported;
            skippedAttachments += attachmentResult.skipped;
          } catch (error) {
            const message = `Attachment import failed for ${issue.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            warnings.push(message);
            issueResult.status = 'partial';
            issueResult.failedStep = issueResult.failedStep || 'attachments';
            issueResult.errors.push(message);
            logger.error(`${issueLogPrefix} Attachment import failed`, {
              issueKey: issue.key,
              failedStep: issueResult.failedStep,
              status: issueResult.status,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }

          if (importedCommentData) {
            try {
              const commentAttachmentResult = await this.importCommentAttachments(
                issue,
                conversationId,
                ticketId,
                importedCommentData.comments,
                importedCommentData.commentMessageMap,
                actorUserId,
                unresolvedUsers,
              );
              importedAttachments += commentAttachmentResult.imported;
              skippedAttachments += commentAttachmentResult.skipped;
              if (commentAttachmentResult.warnings.length > 0) {
                warnings.push(...commentAttachmentResult.warnings);
                logger.warn(`${issueLogPrefix} Comment attachment mapping warnings`, {
                  issueKey: issue.key,
                  warnings: commentAttachmentResult.warnings,
                });
              }
            } catch (error) {
              const message = `Comment attachment import failed for ${issue.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
              warnings.push(message);
              issueResult.status = 'partial';
              issueResult.failedStep = issueResult.failedStep || 'comment_attachments';
              issueResult.errors.push(message);
              logger.error(`${issueLogPrefix} Comment attachment import failed`, {
                issueKey: issue.key,
                failedStep: issueResult.failedStep,
                status: issueResult.status,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
          issueResults.push(issueResult);
          logger.info(`${issueLogPrefix} Jira issue processed`, {
            issueKey: issue.key,
            status: issueResult.status,
            failedStep: issueResult.failedStep,
            ticketAction: existingTicket ? 'reused' : 'created',
            importedTickets,
            skippedTickets,
            importedComments,
            skippedComments,
            importedAttachments,
            skippedAttachments,
            errors: issueResult.errors,
          });
          processedIssues += 1;
          await publishProgress(issue.key, 'issue_completed', issueResult);
        } catch (error) {
          const message = `Ticket import failed for ${issue.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          warnings.push(message);
          issueResult.status = 'failed';
          issueResult.failedStep = issueResult.failedStep || 'ticket';
          issueResult.errors.push(message);
          issueResults.push(issueResult);
          processedIssues += 1;
          await publishProgress(issue.key, 'ticket', issueResult);
          logger.error(`${issueLogPrefix} Ticket import failed`, {
            issueKey: issue.key,
            failedStep: issueResult.failedStep,
            status: issueResult.status,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    };

    if (input.issueKeys && input.issueKeys.length > 0) {
      const selectedIssues = await this.jiraClient.fetchIssuesByKeys(jiraProjectKey, input.issueKeys, input.dateFrom);
      totalIssues = selectedIssues.length;
      await ensureInitialProgress();
      await processIssuesChunk(selectedIssues);
    } else {
      let nextPageToken: string | undefined;
      let hasNextPage = true;
      const pageSize = 100;

      while (hasNextPage) {
        const page = await this.jiraClient.fetchIssuesPage(jiraProjectKey, nextPageToken, pageSize, input.dateFrom);
        if (!initialProgressPublished) {
          totalIssues = page.total;
          await ensureInitialProgress();
        }

        await processIssuesChunk(page.issues);

        nextPageToken = page.nextPageToken || undefined;
        hasNextPage = page.hasNextPage;

        if (page.issues.length === 0) {
          break;
        }
      }
    }

    await ensureInitialProgress();
    await this.flushPendingExternalTicketMappings();

    const createdSubTickets = await this.createSubTicketMappings(
      relationshipIssues,
      actorUserId,
      fieldDefinitions,
      jiraProjectKey,
    );
    const linkedTickets = await this.importRelationships(relationshipIssues, actorUserId, jiraProjectKey);

    logger.info(`${buildJiraMigrationProjectLogPrefix(jiraProjectKey)} Migration completed`, {
      totalIssues,
      importedTickets,
      skippedTickets,
      importedComments,
      skippedComments,
      importedAttachments,
      skippedAttachments,
      createdBoardCustomFields: createdCount,
      reusedBoardCustomFields: reusedCount,
      warningsCount: warnings.length,
      unresolvedUsersCount: unresolvedUsers.size,
    });

    return {
      jiraProjectKey,
      externalSourceCreated,
      externalSourceId,
      importedTickets,
      skippedTickets,
      importedComments,
      skippedComments,
      importedAttachments,
      skippedAttachments,
      createdBoardCustomFields: createdCount,
      reusedBoardCustomFields: reusedCount,
      linkedTickets,
      createdSubTickets,
      unresolvedUsers: Array.from(unresolvedUsers.values()),
      issueResults,
      warnings,
    };
  }
}

export const jiraMigrationImportService = new JiraMigrationImportService();
