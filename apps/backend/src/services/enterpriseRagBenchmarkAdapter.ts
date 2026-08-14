import { createHash } from 'crypto';
import { vespaService } from '@/services/vespaSearch';
import {
  channelSchema,
  fileSchema,
  mailSchema,
  messageSchema,
  projectSchema,
  ticketSchema,
  type VespaSchema,
} from '@/vespa/src/types';
import { logger } from '@/utils/logger';

export const ENTERPRISE_RAG_SOURCE_TYPES = [
  'confluence',
  'fireflies',
  'github',
  'gmail',
  'google_drive',
  'hubspot',
  'jira',
  'linear',
  'slack',
] as const;

export type EnterpriseRagSourceType = (typeof ENTERPRISE_RAG_SOURCE_TYPES)[number];

export type EnterpriseRagIngestionPath =
  | 'conversation'
  | 'mail'
  | 'ticket'
  | 'transcript'
  | 'knowledge_base';

export interface EnterpriseRagDocumentInput {
  rowIndex: number;
  docId: string;
  sourceType: EnterpriseRagSourceType;
  title: string;
  content: string;
}

export interface EnterpriseRagContext {
  orgId: string;
  workspaceId: string;
  userId: string;
  userName: string;
  userEmail: string;
}

interface EnterpriseRagAdapterPayload extends EnterpriseRagDocumentInput {
  ingestionPath: EnterpriseRagIngestionPath;
  syntheticId: string;
  metadata: {
    benchmark: 'EnterpriseRAG-Bench';
    benchmarkDocId: string;
    benchmarkRow: number;
    benchmarkSourceType: EnterpriseRagSourceType;
  };
}

export interface EnterpriseRagIngestResult {
  success: true;
  status: 'inserted' | 'duplicate';
  benchmarkDocId: string;
  sourceType: EnterpriseRagSourceType;
  classification: EnterpriseRagIngestionPath;
  ingestionPath: EnterpriseRagIngestionPath;
  entityIds: string[];
  schemas: string[];
  queueJobs: Array<{ id: string; queue: string; schema: string; docId: string }>;
}

const RESOURCE_PREFIX = 'EnterpriseRAG Bench';
const VESPA_NAMESPACE = 'benchmark';

const classifySource = (sourceType: EnterpriseRagSourceType): EnterpriseRagIngestionPath => {
  if (sourceType === 'slack') return 'conversation';
  if (sourceType === 'gmail') return 'mail';
  if (sourceType === 'jira' || sourceType === 'linear') return 'ticket';
  if (sourceType === 'fireflies') return 'transcript';
  return 'knowledge_base';
};

const mapEnterpriseRagRow = (input: EnterpriseRagDocumentInput): EnterpriseRagAdapterPayload => {
  const digest = createHash('sha256')
    .update(`${input.sourceType}${input.docId}`)
    .digest('hex')
    .slice(0, 24);
  return {
    ...input,
    ingestionPath: classifySource(input.sourceType),
    syntheticId: `enterprise-rag-bench-${input.sourceType}-${digest}`,
    metadata: {
      benchmark: 'EnterpriseRAG-Bench',
      benchmarkDocId: input.docId,
      benchmarkRow: input.rowIndex,
      benchmarkSourceType: input.sourceType,
    },
  };
};

// Deterministic synthetic ids — no DB anywhere in this file, Vespa only.
const syntheticUserId = (workspaceId: string): string => `bench-user-${workspaceId}`;
const syntheticChannelId = (workspaceId: string, sourceType: EnterpriseRagSourceType): string =>
  `bench-ch-${workspaceId}-${sourceType}`;
const syntheticProjectId = (workspaceId: string): string => `bench-proj-${workspaceId}`;

const channelRefId = (channelId: string): string =>
  `id:${VESPA_NAMESPACE}:${channelSchema}::${channelId}`;
const projectRefId = (projectId: string): string =>
  `id:${VESPA_NAMESPACE}:${projectSchema}::${projectId}`;

const metadataString = (payload: EnterpriseRagAdapterPayload): string =>
  JSON.stringify({ enterpriseRag: payload.metadata });

const nowMs = (): number => Date.now();

const insertOpts = (schema: string) => ({ namespace: VESPA_NAMESPACE, schema: schema as VespaSchema });

let workspaceContainerPromise = new Map<string, Promise<void>>();

/**
 * Ensure the parent `chat_container` exists for (workspaceId, sourceType). Without
 * it, every child schema's imported ACL fields (channelId, workspaceId,
 * permissions) come back empty and all queries filter out our docs.
 *
 * `permissions: ['*']` means "visible to everyone" — the multi-workspace filter
 * still applies via `workspaceId`, but within the workspace all users can see
 * benchmark docs. That's intentional for a benchmark setup.
 */
const ensureChatContainer = async (context: EnterpriseRagContext, sourceType: EnterpriseRagSourceType): Promise<void> => {
  const key = `${context.workspaceId}:${sourceType}`;
  let pending = workspaceContainerPromise.get(key);
  if (pending) return pending;

  const channelId = syntheticChannelId(context.workspaceId, sourceType);
  pending = (async () => {
    const fields = {
      docId: channelId,
      docType: sourceType,
      orgId: context.orgId,
      workspaceId: context.workspaceId,
      channelName: `${RESOURCE_PREFIX} ${sourceType}`,
      scopeType: 'DEFAULT',
      visibility: 'PUBLIC',
      isIm: false,
      isMpim: false,
      isPrivate: false,
      permissions: ['*'],
      createdBy: context.userId,
      ownerId: context.userId,
      projectId: syntheticProjectId(context.workspaceId),
      lastActivityAt: nowMs(),
      createdAt: nowMs(),
      updatedAt: nowMs(),
      lastSyncedAt: nowMs(),
      topic: sourceType,
      description: `Synthetic ${sourceType} benchmark channel`,
      isArchived: false,
      memberCount: 1,
    };
    await vespaService.vespaClient.insert(fields as never, insertOpts(channelSchema));
  })().catch(err => {
    workspaceContainerPromise.delete(key);
    throw err;
  });
  workspaceContainerPromise.set(key, pending);
  return pending;
};

const ensureProject = async (context: EnterpriseRagContext): Promise<void> => {
  const key = `${context.workspaceId}:__project__`;
  let pending = workspaceContainerPromise.get(key);
  if (pending) return pending;
  const projectId = syntheticProjectId(context.workspaceId);
  pending = (async () => {
    const fields = {
      docId: projectId,
      docType: 'benchmark',
      orgId: context.orgId,
      workspaceId: context.workspaceId,
      name: RESOURCE_PREFIX,
      description: 'Synthetic project for EnterpriseRAG-Bench tickets',
      createdBy: context.userId,
      updatedBy: context.userId,
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };
    await vespaService.vespaClient.insert(fields as never, insertOpts(projectSchema));
  })().catch(err => {
    workspaceContainerPromise.delete(key);
    throw err;
  });
  workspaceContainerPromise.set(key, pending);
  return pending;
};

const chunksFor = (text: string, chunkSize: number = 1900): string[] => {
  if (!text) return [];
  if (text.length <= chunkSize) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) out.push(text.slice(i, i + chunkSize));
  return out;
};

const feedConversation = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
): Promise<Pick<EnterpriseRagIngestResult, 'status' | 'entityIds' | 'schemas' | 'queueJobs'>> => {
  await ensureChatContainer(context, payload.sourceType);
  const channelId = syntheticChannelId(context.workspaceId, payload.sourceType);
  const fields = {
    docId: payload.syntheticId,
    docType: payload.sourceType,
    text: payload.title,
    chunks: chunksFor(payload.content),
    userId: syntheticUserId(context.workspaceId),
    username: context.userName,
    userEmail: context.userEmail,
    createdAtTimestamp: nowMs(),
    createdAt: new Date().toISOString(),
    messageType: 'MESSAGE',
    threadId: payload.syntheticId,
    isRootMessage: true,
    channelRef: channelRefId(channelId),
    attachmentIds: [],
    reactions: 0,
    replyCount: 0,
    replyUsersCount: 0,
    mentions: [],
    channelMentions: [],
    updatedAt: new Date().toISOString(),
    deletedAt: 0,
    metadata: metadataString(payload),
    messageChannelName: `${RESOURCE_PREFIX} ${payload.sourceType}`,
    threadMentions: [],
    threadSenders: [],
  };
  await vespaService.vespaClient.insert(fields as never, insertOpts(messageSchema));
  return { status: 'inserted', entityIds: [payload.syntheticId], schemas: [messageSchema], queueJobs: [] };
};

const feedMail = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
): Promise<Pick<EnterpriseRagIngestResult, 'status' | 'entityIds' | 'schemas' | 'queueJobs'>> => {
  await ensureChatContainer(context, payload.sourceType);
  const channelId = syntheticChannelId(context.workspaceId, payload.sourceType);
  const fields = {
    docId: payload.syntheticId,
    docType: 'mail',
    orgId: context.orgId,
    workspaceId: context.workspaceId,
    threadId: payload.syntheticId,
    mailId: payload.syntheticId,
    xyneId: payload.syntheticId,
    subject: payload.title,
    chunks: chunksFor(payload.content),
    timestamp: nowMs(),
    app: 'benchmark',
    entity: 'benchmark',
    channelRef: channelRefId(channelId),
    from: context.userEmail,
    to: [context.userEmail],
    cc: [],
    bcc: [],
    attachmentFilenames: [],
    generatedTags: [],
  };
  await vespaService.vespaClient.insert(fields as never, insertOpts(mailSchema));
  return { status: 'inserted', entityIds: [payload.syntheticId], schemas: [mailSchema], queueJobs: [] };
};

const feedTicket = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
): Promise<Pick<EnterpriseRagIngestResult, 'status' | 'entityIds' | 'schemas' | 'queueJobs'>> => {
  await Promise.all([ensureChatContainer(context, payload.sourceType), ensureProject(context)]);
  const channelId = syntheticChannelId(context.workspaceId, payload.sourceType);
  const projectId = syntheticProjectId(context.workspaceId);
  const fields = {
    docId: payload.syntheticId,
    docType: 'ticket',
    convId: payload.syntheticId,
    userGroupId: '',
    channelRef: channelRefId(channelId),
    projectRef: projectRefId(projectId),
    threadId: payload.syntheticId,
    status: 'OPEN',
    ownerEmail: context.userEmail,
    assignedTo: context.userEmail,
    createdBy: context.userEmail,
    closedBy: '',
    title: payload.title,
    workflowType: 'BENCH',
    description: payload.content.slice(0, 4000),
    chunks: chunksFor(payload.content),
    ticketType: payload.sourceType.toUpperCase(),
    priority: 'LOW',
    stage: 'Benchmark',
    createdAtTimestamp: nowMs(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closedAt: '',
    deletedAt: '',
    parentTicketId: '',
    boardId: '',
    attachmentIds: [],
    metadata: metadataString(payload),
    formFields: [],
    eta: '',
    channelName: `${RESOURCE_PREFIX} ${payload.sourceType}`,
    boardName: 'Benchmark',
    xyneId: payload.syntheticId,
    tags: [],
    generatedTags: [],
    createdByName: context.userName,
    assignedToName: context.userName,
    closedByName: '',
    projectName: RESOURCE_PREFIX,
    ticketMentions: [],
    threadMentions: [],
    threadSenders: [],
    replyCount: 0,
    initialMessage: '',
    initialMessageSender: '',
    parentTicketXyneId: '',
    childTicketXyneIds: [],
  };
  await vespaService.vespaClient.insert(fields as never, insertOpts(ticketSchema));
  return { status: 'inserted', entityIds: [payload.syntheticId], schemas: [ticketSchema], queueJobs: [] };
};

const feedFile = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
  opts: { subApp: string },
): Promise<Pick<EnterpriseRagIngestResult, 'status' | 'entityIds' | 'schemas' | 'queueJobs'>> => {
  await ensureChatContainer(context, payload.sourceType);
  const channelId = syntheticChannelId(context.workspaceId, payload.sourceType);
  const fields = {
    docId: payload.syntheticId,
    docType: 'file',
    orgId: context.orgId,
    workspaceId: context.workspaceId,
    fileName: payload.title,
    description: payload.content.slice(0, 4000),
    chunks: chunksFor(payload.content),
    chunks_pos: chunksFor(payload.content).map((_, i) => String(i)),
    image_chunks: [],
    image_chunks_pos: [],
    metadata: metadataString(payload),
    createdBy: syntheticUserId(context.workspaceId),
    createdAt: nowMs(),
    updatedAt: nowMs(),
    ownerId: syntheticUserId(context.workspaceId),
    permissions: [context.userEmail],
    urlInternal: '',
    urlOriginal: '',
    fileSize: Buffer.byteLength(payload.content, 'utf8'),
    isPrivate: false,
    mimeType: 'text/plain',
    subApp: opts.subApp,
    channelRef: channelRefId(channelId),
  };
  await vespaService.vespaClient.insert(fields as never, insertOpts(fileSchema));
  return { status: 'inserted', entityIds: [payload.syntheticId], schemas: [fileSchema], queueJobs: [] };
};

export const ingestEnterpriseRagDocument = async (
  input: EnterpriseRagDocumentInput,
  context: EnterpriseRagContext,
): Promise<EnterpriseRagIngestResult> => {
  const payload = mapEnterpriseRagRow(input);

  const schemaForPath =
    payload.ingestionPath === 'conversation' ? messageSchema
    : payload.ingestionPath === 'mail' ? mailSchema
    : payload.ingestionPath === 'ticket' ? ticketSchema
    : fileSchema;

  try {
    const existing = await vespaService.vespaClient.getDocument({
      docId: payload.syntheticId,
      schema: schemaForPath,
      namespace: VESPA_NAMESPACE,
    });
    if (existing) {
      return {
        success: true,
        status: 'duplicate',
        benchmarkDocId: payload.docId,
        sourceType: payload.sourceType,
        classification: payload.ingestionPath,
        ingestionPath: payload.ingestionPath,
        entityIds: [payload.syntheticId],
        schemas: [schemaForPath],
        queueJobs: [],
      };
    }
  } catch {
    // Document doesn't exist — proceed with insert
  }

  logger.info('[EnterpriseRAG] Ingesting document (direct Vespa)', {
    docId: payload.docId,
    syntheticId: payload.syntheticId,
    path: payload.ingestionPath,
    sourceType: payload.sourceType,
  });

  const result =
    payload.ingestionPath === 'conversation'
      ? await feedConversation(payload, context)
      : payload.ingestionPath === 'mail'
        ? await feedMail(payload, context)
        : payload.ingestionPath === 'ticket'
          ? await feedTicket(payload, context)
          : payload.ingestionPath === 'transcript'
            ? await feedFile(payload, context, { subApp: 'transcript' })
            : await feedFile(payload, context, { subApp: 'knowledge_base' });

  return {
    success: true,
    benchmarkDocId: payload.docId,
    sourceType: payload.sourceType,
    classification: payload.ingestionPath,
    ingestionPath: payload.ingestionPath,
    ...result,
  };
};

interface VespaCountResponse {
  root?: { fields?: { totalCount?: number } };
}

const countByChannel = async (schema: string, channelId: string): Promise<number> => {
  const response = await vespaService.vespaClient.search<VespaCountResponse>({
    yql: `select * from ${schema} where channelId contains @channelId`,
    channelId,
    hits: 0,
  });
  return response.root?.fields?.totalCount ?? 0;
};

export const getEnterpriseRagDocumentCounts = async (
  workspaceId: string,
): Promise<{
  total: number;
  sourceRows: number;
  bySchema: Record<string, number>;
  bySource: Record<EnterpriseRagSourceType, number>;
}> => {
  const bySource = Object.fromEntries(
    ENTERPRISE_RAG_SOURCE_TYPES.map(source => [source, 0]),
  ) as Record<EnterpriseRagSourceType, number>;

  const perSourceCounts = await Promise.all(
    ENTERPRISE_RAG_SOURCE_TYPES.map(async source => {
      const channelId = syntheticChannelId(workspaceId, source);
      const path = classifySource(source);
      let count = 0;
      if (path === 'conversation') {
        count = await countByChannel(messageSchema, channelId);
      } else if (path === 'mail') {
        count = await countByChannel(mailSchema, channelId);
      } else if (path === 'ticket') {
        count = await countByChannel(ticketSchema, channelId);
      } else {
        count = await countByChannel(fileSchema, channelId);
      }
      return [source, count] as const;
    }),
  );
  for (const [source, count] of perSourceCounts) bySource[source] = count;

  const bySchema = {
    [messageSchema]: bySource.slack,
    [mailSchema]: bySource.gmail,
    [ticketSchema]: bySource.jira + bySource.linear,
    [fileSchema]:
      bySource.fireflies +
      bySource.confluence +
      bySource.github +
      bySource.google_drive +
      bySource.hubspot,
    sam_transcript: 0,
  };
  const total = Object.values(bySchema).reduce((sum, n) => sum + n, 0);
  const sourceRows = Object.values(bySource).reduce((sum, n) => sum + n, 0);
  return { total, sourceRows, bySchema, bySource };
};
