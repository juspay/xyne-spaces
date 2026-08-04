import { createHash } from 'crypto';
import {
  BoardType,
  CallOrigin,
  CallStatus,
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  IngestionStatus,
  MessageType,
  Prisma,
  TicketPriority,
} from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { CollectionRepository } from '@/database/repositories/collectionRepository';
import { createTicketWithConversation } from '@/apps/core/ticketutils';
import { conversationService } from '@/services/conversationService';
import { emailService } from '@/services/emailService';
import { getStorageService } from '@/services/storage/storageServiceFactory';
import { config } from '@/config/env';
import { vespaQueue } from '@/queues/vespaQueue';
import { vespaService } from '@/services/vespaSearch';
import {
  channelSchema,
  fileSchema,
  mailSchema,
  messageSchema,
  projectSchema,
  SubApp,
  ticketSchema,
} from '@/vespa/src/types';
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

const classifySource = (sourceType: EnterpriseRagSourceType): EnterpriseRagIngestionPath => {
  if (sourceType === 'slack') return 'conversation';
  if (sourceType === 'gmail') return 'mail';
  if (sourceType === 'jira' || sourceType === 'linear') return 'ticket';
  if (sourceType === 'fireflies') return 'transcript';
  return 'knowledge_base';
};

const mapEnterpriseRagRow = (
  input: EnterpriseRagDocumentInput,
): EnterpriseRagAdapterPayload => {
  const digest = createHash('sha256')
    .update(`${input.sourceType}\u0000${input.docId}`)
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

const db = DatabaseClient.getInstance();
const collectionRepository = new CollectionRepository();
const RESOURCE_PREFIX = 'EnterpriseRAG Bench';

interface BenchmarkResources {
  projectId: string;
  boardId: string;
  channelId: string;
  collectionId?: string;
}

export interface EnterpriseRagIngestResult {
  success: true;
  status: 'queued' | 'duplicate';
  benchmarkDocId: string;
  sourceType: EnterpriseRagSourceType;
  classification: EnterpriseRagIngestionPath;
  ingestionPath: EnterpriseRagIngestionPath;
  entityIds: string[];
  schemas: string[];
  queueJobs: Array<{ id: string; queue: string; schema: string; docId: string }>;
}

const resourcePromises = new Map<string, Promise<BenchmarkResources>>();

const channelTypeFor = (path: EnterpriseRagIngestionPath): ChannelType => {
  if (path === 'mail') return ChannelType.EMAIL;
  if (path === 'conversation') return ChannelType.SLACK;
  if (path === 'transcript') return ChannelType.CALL;
  return ChannelType.DEFAULT;
};

const ensureBenchmarkResourcesUncached = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
): Promise<BenchmarkResources> => {
  const [workspace, user] = await Promise.all([
    db.workspace.findUnique({ where: { id: context.workspaceId }, select: { id: true } }),
    db.user.findUnique({ where: { id: context.userId }, select: { id: true, workspaceId: true } }),
  ]);
  if (!workspace) throw new Error(`Workspace ${context.workspaceId} was not found`);
  if (!user || user.workspaceId !== context.workspaceId) {
    throw new Error(`User ${context.userId} does not belong to workspace ${context.workspaceId}`);
  }

  const project = await db.project.upsert({
    where: { name_workspaceId: { name: RESOURCE_PREFIX, workspaceId: context.workspaceId } },
    update: { description: 'Synthetic containers for EnterpriseRAG-Bench ingestion' },
    create: {
      name: RESOURCE_PREFIX,
      code: 'ERB',
      description: 'Synthetic containers for EnterpriseRAG-Bench ingestion',
      workspaceId: context.workspaceId,
      createdBy: context.userId,
      updatedBy: context.userId,
    },
  });

  const board = await db.board.upsert({
    where: { name_projectId: { name: `${RESOURCE_PREFIX} Tickets`, projectId: project.id } },
    update: {},
    create: {
      name: `${RESOURCE_PREFIX} Tickets`,
      boardType: BoardType.DEFAULT,
      projectId: project.id,
      workspaceId: context.workspaceId,
      createdBy: context.userId,
      updatedBy: context.userId,
      description: 'Synthetic Jira and Linear benchmark tickets',
    },
  });

  const stage = await db.stage.findFirst({ where: { boardId: board.id }, select: { id: true } });
  if (!stage) {
    await db.stage.create({
      data: {
        name: 'Benchmark',
        boardId: board.id,
        sequenceNumber: 0,
        createdBy: context.userId,
        updatedBy: context.userId,
        workspaceId: context.workspaceId,
      },
    });
  }

  const channelName = `${RESOURCE_PREFIX} ${payload.sourceType}`;
  let channel = await db.channel.findFirst({
    where: { workspaceId: context.workspaceId, name: channelName },
  });
  if (!channel) {
    channel = await db.channel.create({
      data: {
        name: channelName,
        description: `Synthetic ${payload.sourceType} ingestion channel`,
        type: channelTypeFor(payload.ingestionPath),
        scopeType: ChannelScopeType.DEFAULT,
        visibility: ChannelVisibility.PRIVATE,
        createdBy: context.userId,
        projectId: project.id,
        workspaceId: context.workspaceId,
        metadata: { benchmark: 'EnterpriseRAG-Bench', sourceType: payload.sourceType },
      },
    });
  }

  await db.channelParticipant.upsert({
    where: { channelId_userId: { channelId: channel.id, userId: context.userId } },
    update: {},
    create: {
      channelId: channel.id,
      userId: context.userId,
      workspaceId: context.workspaceId,
      role: 'ADMIN',
    },
  });

  // Supporting documents also use the normal queue; no benchmark code writes Vespa documents.
  await Promise.all([
    vespaQueue.addJob({
      schema: projectSchema,
      docId: project.id,
      jobType: 'feed',
      userId: context.userId,
      workspaceId: context.workspaceId,
    }),
    vespaQueue.addJob({
      schema: channelSchema,
      docId: channel.id,
      jobType: 'feed',
      userId: context.userId,
      workspaceId: context.workspaceId,
    }),
  ]);

  let collectionId: string | undefined;
  if (payload.ingestionPath === 'knowledge_base') {
    const collectionName = `${RESOURCE_PREFIX} ${payload.sourceType} KB`;
    let collection = await db.collection.findFirst({
      where: {
        parentId: null,
        ownerId: context.userId,
        name: collectionName,
        scopeType: 'CHANNEL',
        scopeId: channel.id,
        deletedAt: null,
      },
    });
    if (!collection) {
      collection = await db.collection.create({
        data: {
          name: collectionName,
          ownerId: context.userId,
          workspaceId: context.workspaceId,
          scopeType: 'CHANNEL',
          scopeId: channel.id,
          description: `EnterpriseRAG-Bench ${payload.sourceType} documents`,
          isPrivate: true,
          createdAt: new Date(),
        },
      });
    }
    await db.collectionPermission.upsert({
      where: { collectionId_userId: { collectionId: collection.id, userId: context.userId } },
      update: { role: 'OWNER', canShare: true },
      create: {
        collectionId: collection.id,
        userId: context.userId,
        workspaceId: context.workspaceId,
        role: 'OWNER',
        canShare: true,
        grantedBy: context.userId,
        createdAt: new Date(),
      },
    });
    collectionId = collection.id;
  }

  return { projectId: project.id, boardId: board.id, channelId: channel.id, collectionId };
};

const ensureBenchmarkResources = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
): Promise<BenchmarkResources> => {
  const key = `${context.workspaceId}:${context.userId}:${payload.sourceType}`;
  let pending = resourcePromises.get(key);
  if (!pending) {
    pending = ensureBenchmarkResourcesUncached(payload, context);
    resourcePromises.set(key, pending);
    pending.catch(() => resourcePromises.delete(key));
  }
  return pending;
};

const queueInfo = (
  jobs: Awaited<ReturnType<typeof vespaQueue.addJob>>,
  schema: string,
  docId: string,
): EnterpriseRagIngestResult['queueJobs'] =>
  jobs.map(job => ({ id: String(job.id), queue: job.queue.name, schema, docId }));

const ingestConversation = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
  resources: BenchmarkResources,
): Promise<Pick<EnterpriseRagIngestResult, 'status' | 'entityIds' | 'schemas' | 'queueJobs'>> => {
  const existing = await db.message.findFirst({
    where: {
      workspaceId: context.workspaceId,
      metadata: { path: ['enterpriseRag', 'benchmarkDocId'], equals: payload.docId },
    },
    select: { messageId: true },
  });
  if (existing) {
    return { status: 'duplicate', entityIds: [existing.messageId], schemas: [messageSchema], queueJobs: [] };
  }

  const result = await conversationService.createConversationWithMessage({
    channelId: resources.channelId,
    userId: context.userId,
    content: payload.content,
    msgType: MessageType.BOT,
    isBot: true,
    isMarkdown: false,
    metadata: { enterpriseRag: payload.metadata },
    messageMetadata: { enterpriseRag: payload.metadata, syntheticId: payload.syntheticId },
  });
  return {
    status: 'queued',
    entityIds: [result.message.messageId],
    schemas: [messageSchema],
    queueJobs: [],
  };
};

const ingestMail = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
  resources: BenchmarkResources,
): Promise<Pick<EnterpriseRagIngestResult, 'status' | 'entityIds' | 'schemas' | 'queueJobs'>> => {
  const existing = await db.email.findUnique({
    where: {
      externalMessageId_channelId: {
        externalMessageId: payload.syntheticId,
        channelId: resources.channelId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return { status: 'duplicate', entityIds: [existing.id], schemas: [mailSchema, ticketSchema], queueJobs: [] };
  }

  const result = await emailService.createConversationWithEmail({
    channelId: resources.channelId,
    boardId: resources.boardId,
    userId: context.userId,
    emailSubject: payload.title,
    emailBody: payload.content,
    emailTo: [context.userEmail],
    emailFrom: context.userEmail,
    externalThreadId: payload.syntheticId,
    externalMessageId: payload.syntheticId,
    ticketMetadata: { enterpriseRag: payload.metadata, syntheticId: payload.syntheticId },
  });
  if ('blocked' in result || 'isDuplicate' in result) {
    return { status: 'duplicate', entityIds: [], schemas: [mailSchema, ticketSchema], queueJobs: [] };
  }
  return {
    status: 'queued',
    entityIds: [result.email.id, result.ticket.id],
    schemas: [mailSchema, ticketSchema],
    queueJobs: [],
  };
};

const ingestTicket = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
  resources: BenchmarkResources,
): Promise<Pick<EnterpriseRagIngestResult, 'status' | 'entityIds' | 'schemas' | 'queueJobs'>> => {
  const existing = await db.ticket.findFirst({
    where: {
      workspaceId: context.workspaceId,
      metadata: { path: ['enterpriseRag', 'benchmarkDocId'], equals: payload.docId },
    },
    select: { id: true },
  });
  if (existing) {
    return { status: 'duplicate', entityIds: [existing.id], schemas: [ticketSchema], queueJobs: [] };
  }

  const result = await createTicketWithConversation({
    title: payload.title,
    description: payload.content,
    projectId: resources.projectId,
    boardId: resources.boardId,
    channelId: resources.channelId,
    userId: context.userId,
    priority: TicketPriority.LOW,
    text: payload.content,
    ticketType: payload.sourceType.toUpperCase(),
  });
  await db.ticket.update({
    where: { id: result.ticketId },
    data: { metadata: { enterpriseRag: payload.metadata, syntheticId: payload.syntheticId } },
  });
  return {
    status: 'queued',
    entityIds: [result.ticketId, result.messageId],
    schemas: [ticketSchema, messageSchema],
    queueJobs: [],
  };
};

const ingestTranscript = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
  resources: BenchmarkResources,
): Promise<Pick<EnterpriseRagIngestResult, 'status' | 'entityIds' | 'schemas' | 'queueJobs'>> => {
  const transcriptPath = `attachments/${payload.syntheticId}.txt`;
  const transcriptStorage = getStorageService(config.gcs.transcriptionBucketName);
  await transcriptStorage.uploadFileV2(Buffer.from(payload.content, 'utf8'), {
    path: transcriptPath,
    contentType: 'text/plain',
    metadata: {
      benchmark: 'EnterpriseRAG-Bench',
      benchmarkDocId: payload.docId,
      benchmarkSourceType: payload.sourceType,
    },
  });

  const existing = await db.call.findUnique({
    where: { externalId: payload.syntheticId },
    select: { id: true },
  });
  const call = await db.call.upsert({
    where: { externalId: payload.syntheticId },
    update: {
      title: payload.title,
      transcript: transcriptPath,
      metadata: { enterpriseRag: payload.metadata, syntheticId: payload.syntheticId },
    },
    create: {
      externalId: payload.syntheticId,
      title: payload.title,
      createdByUserId: context.userId,
      organizerId: context.userId,
      channelId: resources.channelId,
      callOrigin: CallOrigin.CHANNEL,
      status: CallStatus.ENDED,
      transcript: transcriptPath,
      endedAt: new Date(),
      workspaceId: context.workspaceId,
      metadata: { enterpriseRag: payload.metadata, syntheticId: payload.syntheticId },
    },
  });
  await db.callParticipant.upsert({
    where: { callId_userId: { callId: call.id, userId: context.userId } },
    update: {},
    create: {
      callId: call.id,
      userId: context.userId,
      invitedBy: context.userId,
      workspaceId: context.workspaceId,
      displayName: context.userName,
      isExternal: false,
    },
  });
  const jobs = await vespaQueue.addJob({
    schema: fileSchema,
    docId: call.id,
    jobType: 'feed',
    userId: context.userId,
    app: SubApp.TRANSCRIPT,
    workspaceId: context.workspaceId,
  });
  return {
    status: existing ? 'duplicate' : 'queued',
    entityIds: [call.id],
    schemas: [fileSchema],
    queueJobs: queueInfo(jobs, fileSchema, call.id),
  };
};

const ingestKnowledgeBaseDocument = async (
  payload: EnterpriseRagAdapterPayload,
  context: EnterpriseRagContext,
  resources: BenchmarkResources,
): Promise<Pick<EnterpriseRagIngestResult, 'status' | 'entityIds' | 'schemas' | 'queueJobs'>> => {
  if (!resources.collectionId) throw new Error('Benchmark KB collection was not initialized');
  const safeTitle = payload.title.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'document';
  const fileName = `${safeTitle}-${payload.syntheticId.slice(-12)}.txt`;
  const existing = await collectionRepository.findItemByPath(resources.collectionId, fileName);
  if (existing) {
    await db.collectionItem.update({
      where: { id: existing.id },
      data: { ingestionStatus: IngestionStatus.PENDING },
    });
    const jobs = await vespaQueue.addJob({
      schema: fileSchema,
      docId: existing.fileId,
      jobType: 'feed',
      userId: context.userId,
      app: SubApp.COLLECTIONS,
      workspaceId: context.workspaceId,
    });
    return {
      status: 'duplicate',
      entityIds: [existing.fileId],
      schemas: [fileSchema],
      queueJobs: queueInfo(jobs, fileSchema, existing.fileId),
    };
  }

  const content = Buffer.from(payload.content, 'utf8');
  const upload = await getStorageService().uploadFile(content, {
    filename: fileName,
    contentType: 'text/plain',
    scopeType: 'collection',
    scopeId: resources.collectionId,
    metadata: {
      benchmark: 'EnterpriseRAG-Bench',
      benchmarkDocId: payload.docId,
      benchmarkSourceType: payload.sourceType,
    },
  });
  const item = await collectionRepository.createFileItem({
    rootCollectionId: resources.collectionId,
    collectionId: resources.collectionId,
    name: fileName,
    storageKey: upload.path,
    mimeType: 'text/plain',
    fileSize: content.length,
    ownerId: context.userId,
    workspaceId: context.workspaceId,
    ingestionStatus: IngestionStatus.PENDING,
  });
  await db.messageAttachment.updateMany({
    where: { entityId: item.id, entityType: 'COLLECTION' },
    data: { metadata: { enterpriseRag: payload.metadata, syntheticId: payload.syntheticId } },
  });
  const jobs = await vespaQueue.addJob({
    schema: fileSchema,
    docId: item.fileId,
    jobType: 'feed',
    userId: context.userId,
    app: SubApp.COLLECTIONS,
    workspaceId: context.workspaceId,
  });
  return {
    status: 'queued',
    entityIds: [item.fileId],
    schemas: [fileSchema],
    queueJobs: queueInfo(jobs, fileSchema, item.fileId),
  };
};

export const ingestEnterpriseRagDocument = async (
  input: EnterpriseRagDocumentInput,
  context: EnterpriseRagContext,
): Promise<EnterpriseRagIngestResult> => {
  const payload = mapEnterpriseRagRow(input);
  const resources = await ensureBenchmarkResources(payload, context);

  const result = payload.ingestionPath === 'conversation'
    ? await ingestConversation(payload, context, resources)
    : payload.ingestionPath === 'mail'
      ? await ingestMail(payload, context, resources)
      : payload.ingestionPath === 'ticket'
        ? await ingestTicket(payload, context, resources)
        : payload.ingestionPath === 'transcript'
          ? await ingestTranscript(payload, context, resources)
          : await ingestKnowledgeBaseDocument(payload, context, resources);

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

const countByCollection = async (collectionId: string): Promise<number> => {
  const response = await vespaService.vespaClient.search<VespaCountResponse>({
    yql: `select * from ${fileSchema} where clId contains @collectionId`,
    collectionId,
    hits: 0,
  });
  return response.root?.fields?.totalCount ?? 0;
};

export const getEnterpriseRagDocumentCounts = async (
  workspaceId: string,
): Promise<{ total: number; sourceRows: number; bySchema: Record<string, number> }> => {
  const channels = await db.channel.findMany({
    where: { workspaceId, name: { startsWith: `${RESOURCE_PREFIX} ` } },
    select: { id: true, name: true },
  });
  const bySource = new Map(
    channels.map(channel => [channel.name.slice(`${RESOURCE_PREFIX} `.length), channel.id]),
  );
  const collections = await db.collection.findMany({
    where: {
      workspaceId,
      name: { startsWith: `${RESOURCE_PREFIX} `, endsWith: ' KB' },
      deletedAt: null,
    },
    select: { id: true },
  });

  const [messages, mails, gmailTickets, jiraTickets, linearTickets, transcripts, kbFiles] = await Promise.all([
    bySource.get('slack') ? countByChannel(messageSchema, bySource.get('slack')!) : 0,
    bySource.get('gmail') ? countByChannel(mailSchema, bySource.get('gmail')!) : 0,
    bySource.get('gmail') ? countByChannel(ticketSchema, bySource.get('gmail')!) : 0,
    bySource.get('jira') ? countByChannel(ticketSchema, bySource.get('jira')!) : 0,
    bySource.get('linear') ? countByChannel(ticketSchema, bySource.get('linear')!) : 0,
    bySource.get('fireflies') ? countByChannel(fileSchema, bySource.get('fireflies')!) : 0,
    Promise.all(collections.map(collection => countByCollection(collection.id))).then(counts =>
      counts.reduce((sum, count) => sum + count, 0),
    ),
  ]);

  const tickets = gmailTickets + jiraTickets + linearTickets;
  const files = transcripts + kbFiles;
  const bySchema = {
    [messageSchema]: messages,
    [fileSchema]: files,
    [mailSchema]: mails,
    [ticketSchema]: tickets,
    sam_transcript: 0,
  };
  const total = Object.values(bySchema).reduce((sum, count) => sum + count, 0);
  return {
    total,
    sourceRows: messages + mails + jiraTickets + linearTickets + transcripts + kbFiles,
    bySchema,
  };
};
