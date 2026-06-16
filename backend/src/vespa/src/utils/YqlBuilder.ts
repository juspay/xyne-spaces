import {
  type VespaSchema,
  VespaDocType,
  ticketSchema,
  messageSchema,
  attachmentSchema,
  userSchema,
  channelSchema,
  fileSchema,
  samTranscriptSchema,
  mailSchema,
} from '../types';
import { parseDateToTimestamp, parseTimeKeyword } from './dateParser';

type AppName = 'chat' | 'ticket' | 'user' | 'file' | 'collection' | 'transcript' | 'mail';

const VESPA_MISSING_DYNAMIC_FIELD_VALUE = '__VESPA_MISSING__';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface SlackFilters {
  channelId?: string[];
  projectId?: string[];
  docType?: string[];
  senderId?: string[];
  participants?: string[]; // Participant filter (user IDs) - matches userId, threadMentions, threadSenders
  // Date filters
  createdBefore?: string; // Created before date (multiple formats)
  createdAfter?: string; // Created after date (multiple formats)
  createdOn?: string; // Created on specific date (multiple formats)
  createdRange?: string; // Time keyword (today, yesterday, this week, etc.)
  // When true, exclude messages with messageType="BOT" from chat results.
  // Default behavior (when undefined/false) is to INCLUDE bot messages.
  excludeBotMessages?: boolean;
}

export interface TicketFilters {
  projectId?: string[];
  channelId?: string[];
  status?: string[];
  ticketId?: string[];
  priority?: string[]; // Filter by priority (HIGH, MEDIUM, LOW) - comma-separated
  createdBy?: string[]; // Filter by ticket creator (for from: functionality)
  // New filters
  boardId?: string[]; // Filter by board ID - comma-separated
  tags?: string[]; // Filter by tags
  dynamicFieldValues?: string[]; // Filter by dynamic form field tokens (fieldId::value)
  dynamicFieldDateRanges?: Record<string, { start?: number; end?: number }>;
  createdBefore?: string; // Created before date (multiple formats)
  createdAfter?: string; // Created after date (multiple formats)
  createdOn?: string; // Created on specific date (multiple formats)
  createdRange?: string; // Time keyword (today, yesterday, this week, etc.)
  stage?: string[]; // Filter by ticket stage - comma-separated
  assignedTo?: string[]; // Filter by assigned user ID - comma-separated
}

export interface FileFilters {
  subApp?: string[];
  callType?: string[];
  docType?: string[];
  createdBy?: string[];
  createdBefore?: string;
  createdAfter?: string;
  createdOn?: string;
  createdRange?: string;
  channelId?: string[];
  ownerId?: string[];
  collectionId?: string[];
  fileId?: string[]; // Scope to specific file document(s) by docId
  projectId?: string[];
}

export interface MeetingFilters {
  platform?: string[];
  merchants?: string[];
  type?: string[];
  participants?: string[];
  createdBefore?: string;
  createdAfter?: string;
  createdOn?: string;
  createdRange?: string;
}

export interface MailFilters {
  userEmail?: string;
  channelId?: string[];
  createdBefore?: string;
  createdAfter?: string;
  createdOn?: string;
  createdRange?: string;
}

export class YqlBuilder {
  constructor() {}

  private escapeYqlValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  buildYql(
    query: string,
    schemas: VespaSchema[],
    limit: number,
    apps: string[],
    groupBy: string,
    slackFilters: SlackFilters,
    ticketFilters: TicketFilters,
    fileFilters: FileFilters,
    meetingFilters: MeetingFilters,
    userId: string,
    mailFilters: MailFilters = {},
    useFuzzy: boolean = false,
    useSemanticAnyway: boolean = true,
    workspaceId?: string
  ): string {
    const schemaNames = schemas.join(', ');
    const whereConditions: string[] = [];

    //Build search condition
    const isTranscriptOnly = apps.length === 1 && apps[0].toLowerCase() === 'transcript';
    const queryLength = query?.length ?? 0;

    // Optimization: Skip semantic search for short queries (< 3 chars) - lexical only
    const useSemantic = useSemanticAnyway && queryLength > 3;

    if (query && query !== '*') {
      if (useFuzzy) {
        if (useSemantic) {
          // Hybrid: fuzzy lexical + semantic
          whereConditions.push(`(
      ({defaultIndex: "text_fuzzy"} userInput(@query))
      or ({defaultIndex: "username"} userInput(@query))
      or ({defaultIndex: "mentionChannelName"} userInput(@query))
      or ({defaultIndex: "mentions"} userInput(@query))
      or ({defaultIndex: "title"} userInput(@query))
      or ({defaultIndex: "description"} userInput(@query))
      or ({defaultIndex: "title_fuzzy"} userInput(@query))
      or ({defaultIndex: "description_fuzzy"} userInput(@query))
      or ({defaultIndex: "initialMessage_fuzzy"} userInput(@query))
      or ({defaultIndex: "eta"} userInput(@query))
      or ({defaultIndex: "channelName"} userInput(@query))
      or ({defaultIndex: "boardName"} userInput(@query))
      or ({defaultIndex: "xyneId"} userInput(@query))
      or ({defaultIndex: "tags"} userInput(@query))
      or ({defaultIndex: "createdByName"} userInput(@query))
      or ({defaultIndex: "assignedToName"} userInput(@query))
      or ({defaultIndex: "closedByName"} userInput(@query))
      or ({defaultIndex: "projectName"} userInput(@query))
      or ({defaultIndex: "ticketMentions"} userInput(@query))
      or ({defaultIndex: "threadMentions"} userInput(@query))
      or ({defaultIndex: "threadSenders"} userInput(@query))
      or ({defaultIndex: "parentTicketXyneId"} userInput(@query))
      or ({defaultIndex: "childTicketXyneIds"} userInput(@query))
      or ({defaultIndex: "stage"} userInput(@query))
      or ({defaultIndex: "status"} userInput(@query))
      or ({defaultIndex: "subject_fuzzy"} userInput(@query))
      or ({defaultIndex: "chunks_fuzzy"} userInput(@query))
      or ({targetHits:${limit}} nearestNeighbor(text_embeddings, e))
      or ({targetHits:${limit}} nearestNeighbor(chunk_embeddings, e))
    )`);
        } else {
          // Lexical only: short query, skip semantic
          whereConditions.push(`(
      ({defaultIndex: "text_fuzzy"} userInput(@query))
      or ({defaultIndex: "username"} userInput(@query))
      or ({defaultIndex: "mentionChannelName"} userInput(@query))
      or ({defaultIndex: "mentions"} userInput(@query))
      or ({defaultIndex: "title"} userInput(@query))
      or ({defaultIndex: "description"} userInput(@query))
      or ({defaultIndex: "title_fuzzy"} userInput(@query))
      or ({defaultIndex: "description_fuzzy"} userInput(@query))
      or ({defaultIndex: "initialMessage_fuzzy"} userInput(@query))
      or ({defaultIndex: "eta"} userInput(@query))
      or ({defaultIndex: "channelName"} userInput(@query))
      or ({defaultIndex: "boardName"} userInput(@query))
      or ({defaultIndex: "xyneId"} userInput(@query))
      or ({defaultIndex: "tags"} userInput(@query))
      or ({defaultIndex: "createdByName"} userInput(@query))
      or ({defaultIndex: "assignedToName"} userInput(@query))
      or ({defaultIndex: "closedByName"} userInput(@query))
      or ({defaultIndex: "projectName"} userInput(@query))
      or ({defaultIndex: "ticketMentions"} userInput(@query))
      or ({defaultIndex: "threadMentions"} userInput(@query))
      or ({defaultIndex: "threadSenders"} userInput(@query))
      or ({defaultIndex: "parentTicketXyneId"} userInput(@query))
      or ({defaultIndex: "childTicketXyneIds"} userInput(@query))
      or ({defaultIndex: "stage"} userInput(@query))
      or ({defaultIndex: "status"} userInput(@query))
      or ({defaultIndex: "subject_fuzzy"} userInput(@query))
      or ({defaultIndex: "chunks_fuzzy"} userInput(@query))
    )`);
        }
      } else if (isTranscriptOnly) {
        // sam_transcript schema uses its own embedding fields; text_embeddings/chunk_embeddings don't exist on it
        whereConditions.push(`(
        (userInput(@query))
      or ({targetHits:${limit}} nearestNeighbor(meetingSummary_embeddings, e))
      or ({targetHits:${limit}} nearestNeighbor(chapters_embeddings, e))
      or ({targetHits:${limit}} nearestNeighbor(actionItems_embeddings, e))
      or ({targetHits:${limit}} nearestNeighbor(others_embeddings, e))
      or ({targetHits:${limit}} nearestNeighbor(qna_embeddings, e))
    )`);
      } else {
        // Lexical only: short query
        if (useSemantic) {
          whereConditions.push(`(
          (userInput(@query))
        or ({targetHits:${limit}} nearestNeighbor(text_embeddings, e))
        or ({targetHits:${limit}} nearestNeighbor(chunk_embeddings, e))
        )`);
        } else {
          whereConditions.push(`(userInput(@query))`);
        }
      }
    }
    // Build app-specific conditions.
    // Guarded apps (chat, ticket, file, mail) accept user-supplied filter inputs and
    // enforce per-document permissions. Each app's conditions are wrapped with a
    // mandatory permission guard so that any injected OR branch cannot bypass access
    // control. The guard is built PER APP because the access-control fields differ
    // between schemas: referencing a field that exists in none of an app's schemas
    // makes Vespa reject the whole YQL (e.g. channelPermissions only exists on file).
    // Open apps (user, transcript) have no per-user permission field in Vespa and
    // are kept separate so the permission guard does not exclude their documents.
    const guardedParts: string[] = [];
    const openConditions: string[] = [];

    // Restrict each app's guard to the schemas this query actually selects for it
    // (`schemas` is the pruned `from sources` list). Vespa validates guard fields
    // against the selected sources, so e.g. type=messages (chat_message only) must
    // not emit an `ownerId` clause — chat_message has no ownerId.
    const selectedFor = (appSchemas: VespaSchema[]): VespaSchema[] =>
      appSchemas.filter((s) => schemas.includes(s));

    if (apps.some((a) => a.toLowerCase() === 'chat')) {
      const chatSchemas = selectedFor([messageSchema, channelSchema, attachmentSchema]);
      guardedParts.push(
        `(${this.buildChatConditions(slackFilters, userId, chatSchemas)}) and ${this.buildPermGuard(chatSchemas, userId, workspaceId)}`
      );
    }

    if (apps.some((a) => a.toLowerCase() === 'ticket')) {
      const ticketSchemas = selectedFor([ticketSchema]);
      guardedParts.push(
        `(${this.buildTicketConditions(ticketFilters, userId)}) and ${this.buildPermGuard(ticketSchemas, userId, workspaceId)}`
      );
    }

    if (apps.some((a) => a.toLowerCase() === 'file')) {
      const fileSchemas = selectedFor([fileSchema]);
      guardedParts.push(
        `(${this.buildFileConditions(fileFilters, userId)}) and ${this.buildPermGuard(fileSchemas, userId, workspaceId)}`
      );
    }

    if (apps.some((a) => a.toLowerCase() === 'mail')) {
      const mailSchemas = selectedFor([mailSchema]);
      guardedParts.push(
        `(${this.buildMailConditions(mailFilters, userId)}) and ${this.buildPermGuard(mailSchemas, userId, workspaceId)}`
      );
    }

    if (apps.some((a) => a.toLowerCase() === 'user')) {
      openConditions.push(this.buildUserConditions());
    }

    if (apps.some((a) => a.toLowerCase() === 'transcript')) {
      openConditions.push(this.buildMeetingConditions(meetingFilters));
    }

    // Combine per-app guarded groups with open conditions.
    // Structure: ((chatConds) AND chatGuard) OR ((fileConds) AND fileGuard) OR (openConds)
    // Even if a filter injection creates extra OR branches inside an app's conditions,
    // those branches are still bounded by that app's mandatory AND permGuard.
    // workspaceId is included inside each permGuard (not just as a top-level AND) so
    // that an injected OR branch cannot escape workspace isolation.
    const appConditionParts: string[] = [...guardedParts];
    if (openConditions.length > 0) {
      appConditionParts.push(openConditions.join(' or '));
    }
    if (appConditionParts.length > 0) {
      whereConditions.push(`(${appConditionParts.join(' or ')})`);
    }

    // Workspace isolation: also apply at top level to cover open conditions (user, transcript)
    if (workspaceId) {
      whereConditions.push(`workspaceId contains "${this.escapeYqlValue(workspaceId)}"`);
    }

    let yql = `select * from sources ${schemaNames} where ${whereConditions.join(' and ')}`;

    const isMailOnly = apps.length === 1 && apps[0].toLowerCase() === 'mail';

    if (isMailOnly) {
      // Deduplicate mail results by conversation: one result per threadId,
      // keeping the highest-relevance hit within each thread.
      yql += ` | all(group(threadId) max(${limit}) order(-max(relevance())) each(max(1) each(output(summary(default)))))`;
    } else if (groupBy && apps.length != 1) {
      const groupClause = this.buildGroupingClause(groupBy, limit);
      if (groupClause) {
        yql += `| ${groupClause}`;
      }
    }

    return yql;
  }
  /**
   * Build YQL condition for user search
   * Applies to user schemas
   */
  private buildUserConditions(): string {
    // User search is simple - just filter by docType
    return `docType contains "user"`;
  }
  /**
   * Per-schema field presence used to gate YQL clauses. Vespa rejects a query that
   * references a field absent from EVERY selected source, so each conditional clause
   * may only be emitted when at least one selected schema declares the field.
   * Verified against vespa-core/vespa/common/schemas/*.sd (incl. imported fields):
   * - chat_message:    permissions, isPrivate, messageType, workspaceId  (acl fields imported from channelRef; messageType own)
   * - chat_container:  permissions, ownerId, isPrivate, workspaceId
   * - chat_attachment: permissions, workspaceId                          (permissions imported; no ownerId/isPrivate/messageType)
   * - ticket:          permissions, workspaceId                          (imported from channelRef)
   * - file:            permissions, ownerId, channelPermissions, isPrivate, workspaceId
   * - mail:            permissions, workspaceId                          (permissions imported from channelRef)
   * `permissions` exists in every schema, so the minimum guard is always non-empty.
   */
  private static readonly SCHEMA_FIELDS: Record<
    string,
    { ownerId: boolean; channelPermissions: boolean; isPrivate: boolean; messageType: boolean }
  > = {
    [messageSchema]: {
      ownerId: false,
      channelPermissions: false,
      isPrivate: true,
      messageType: true,
    },
    [channelSchema]: {
      ownerId: true,
      channelPermissions: false,
      isPrivate: true,
      messageType: false,
    },
    [attachmentSchema]: {
      ownerId: false,
      channelPermissions: false,
      isPrivate: false,
      messageType: false,
    },
    [ticketSchema]: {
      ownerId: false,
      channelPermissions: false,
      isPrivate: false,
      messageType: false,
    },
    [fileSchema]: { ownerId: true, channelPermissions: true, isPrivate: true, messageType: false },
    [mailSchema]: {
      ownerId: false,
      channelPermissions: false,
      isPrivate: false,
      messageType: false,
    },
  };

  /**
   * Returns true if ANY of the selected schemas declares the given field.
   * Vespa rejects YQL referencing a field absent from every selected source, so a clause
   * may only be emitted when at least one selected schema has the field.
   */
  private schemasHaveField(
    selectedSchemas: VespaSchema[],
    pick: (f: (typeof YqlBuilder.SCHEMA_FIELDS)[string]) => boolean
  ): boolean {
    return selectedSchemas.some((s) => {
      const fields = YqlBuilder.SCHEMA_FIELDS[s];
      return fields ? pick(fields) : false;
    });
  }

  /**
   * Build the non-bypassable permission guard for a guarded app.
   * The guard references only the access-control fields present in at least one of
   * the schemas this query actually selects (`from sources ...`) for the app —
   * Vespa rejects YQL referencing a field absent from EVERY selected source.
   * `selectedSchemas` is the pruned source list (e.g. for type=messages the chat app
   * selects only chat_message, which has no ownerId), so the guard adapts accordingly.
   * A field existing in ≥1 selected source is also semantically safe: docs in sources
   * lacking that field simply don't match its clause. `permissions` exists everywhere,
   * so the guard is never empty.
   */
  private buildPermGuard(
    selectedSchemas: VespaSchema[],
    userId: string,
    workspaceId?: string
  ): string {
    const accessConditions: string[] = [`permissions contains "${userId}"`];
    if (this.schemasHaveField(selectedSchemas, (f) => f.ownerId)) {
      accessConditions.push(`ownerId contains "${userId}"`);
    }
    if (this.schemasHaveField(selectedSchemas, (f) => f.channelPermissions)) {
      accessConditions.push(`channelPermissions contains "${userId}"`);
    }
    if (this.schemasHaveField(selectedSchemas, (f) => f.isPrivate)) {
      accessConditions.push(`isPrivate contains "false"`);
    }
    const workspaceClause = workspaceId
      ? ` and workspaceId contains "${this.escapeYqlValue(workspaceId)}"`
      : '';
    return `((${accessConditions.join(' or ')})${workspaceClause})`;
  }

  /**
   * Build YQL condition for file search
   * Applies to file schemas
   */
  private buildFileConditions(filters: FileFilters, userId: string): string {
    const conditions: string[] = [];

    // DocType filter
    conditions.push(`docType contains "file"`);

    // Build subApp conditions with appropriate access control
    const subAppConditions: string[] = [];

    // Determine which subApps to include (default to ALL if not specified)
    const subApps =
      filters.subApp && filters.subApp.length > 0
        ? filters.subApp.map((s) => s.trim())
        : ['CANVAS', 'TRANSCRIPT', 'CHAT_ATTACHMENT', 'TICKET_ATTACHMENT', 'RCA'];

    if (filters.channelId && filters.channelId.length > 0) {
      const channelIds = filters.channelId
        .map((c) => `channelId contains "${this.escapeYqlValue(c.trim())}"`)
        .join(' or ');
      conditions.push(`(${channelIds})`);
    }

    // Owner filter (created_by)
    if (filters.ownerId && filters.ownerId.length > 0) {
      const ownerIds = filters.ownerId
        .map((id) => `ownerId contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${ownerIds})`);
    }

    // Canvas: require owner/permissions/isPrivate check
    if (subApps.some((s) => s === 'CANVAS')) {
      subAppConditions.push(
        `((subApp contains "CANVAS") and (ownerId contains "${userId}" or permissions contains "${userId}" or isPrivate contains "false"))`
      );
    }

    // Chat/Ticket/Transcript attachments: require owner/channelPermissions/isPrivate check
    if (
      subApps.some(
        (s) => s === 'CHAT_ATTACHMENT' || s === 'TICKET_ATTACHMENT' || s === 'TRANSCRIPT'
      )
    ) {
      subAppConditions.push(
        `((subApp contains "CHAT_ATTACHMENT" or subApp contains "TICKET_ATTACHMENT" or subApp contains "TRANSCRIPT") and (ownerId contains "${userId}" or channelPermissions contains "${userId}" or isPrivate contains "false"))`
      );
    }

    // RCA: no permission check (public)
    if (subApps.some((s) => s === 'RCA')) {
      subAppConditions.push(`subApp contains "RCA"`);
    }

    // Collections: require owner/permissions/isPrivate check + project scoping
    if (subApps.some((s) => s === 'collections')) {
      let collectionCondition = `(subApp contains "collections") and (ownerId contains "${userId}" or permissions contains "${userId}" or isPrivate contains "false")`;
      if (filters.projectId && filters.projectId.length > 0) {
        const projectCondition = filters.projectId
          .map((id) => `projectId contains "${this.escapeYqlValue(id)}"`)
          .join(' or ');
        collectionCondition += ` and (${projectCondition})`;
      }
      subAppConditions.push(`(${collectionCondition})`);
    }

    if (subAppConditions.length > 0) {
      conditions.push(`(${subAppConditions.join(' or ')})`);
    }

    // Collection ID filter (scope to specific collections)
    if (filters.collectionId && filters.collectionId.length > 0) {
      const orCondition = filters.collectionId
        .map((id) => `clId contains "${this.escapeYqlValue(id)}"`)
        .join(' or ');
      conditions.push(`(${orCondition})`);
    }

    // File ID filter (scope to a specific file/document by its Vespa docId)
    if (filters.fileId && filters.fileId.length > 0) {
      const orCondition = filters.fileId.map(id => `docId contains "${this.escapeYqlValue(id)}"`).join(' or ');
      conditions.push(`(${orCondition})`);
    }

    // callType filter (e.g. HEADLESS for recordings)
    if (filters.callType && filters.callType.length > 0) {
      const types = filters.callType
        .map((t) => `callType contains "${this.escapeYqlValue(t.trim())}"`)
        .join(' or ');
      conditions.push(`(${types})`);
    }

    // createdBy filter (for from: functionality - files uploaded by specific user)
    if (filters.createdBy && filters.createdBy.length > 0) {
      const creators = filters.createdBy
        .map((id) => `createdBy contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${creators})`);
    }

    // Date filters
    if (filters.createdBefore) {
      const timestamp = parseDateToTimestamp(filters.createdBefore, 'start');
      if (timestamp) conditions.push(`createdAtTimestamp < ${timestamp}`);
    }
    if (filters.createdAfter) {
      const timestamp = parseDateToTimestamp(filters.createdAfter, 'end');
      if (timestamp) conditions.push(`createdAtTimestamp > ${timestamp}`);
    }
    if (filters.createdOn) {
      const rangeStart = parseDateToTimestamp(filters.createdOn, 'start');
      const rangeEnd = parseDateToTimestamp(filters.createdOn, 'end');
      if (rangeStart && rangeEnd) {
        conditions.push(
          `(createdAtTimestamp >= ${rangeStart} and createdAtTimestamp <= ${rangeEnd})`
        );
      }
    }

    // Time keyword filter (today, yesterday, this week, last 7 days, etc.)
    if (filters.createdRange) {
      const timeRange = parseTimeKeyword(filters.createdRange);
      if (timeRange) {
        conditions.push(
          `(createdAtTimestamp >= ${timeRange.from} and createdAtTimestamp <= ${timeRange.to})`
        );
      }
    }
    return conditions.join(' and ');
  }

  /**
   * Build YQL condition for Slack app
   * Applies to message, channel, and attachment schemas
   */
  private buildChatConditions(
    filters: SlackFilters,
    userId: string,
    selectedSchemas: VespaSchema[]
  ): string {
    const conditions: string[] = [];
    // DocType filter
    if (filters.docType && filters.docType.length > 0) {
      const docTypes = filters.docType
        .map((t) => `docType contains "${this.escapeYqlValue(t.trim())}"`)
        .join(' or ');
      conditions.push(`(${docTypes})`);
    } else {
      conditions.push(
        `(docType contains "${VespaDocType.MESSAGE}" or docType contains "${VespaDocType.ATTACHMENT}")`
      );
    }

    // Project filter
    if (filters.projectId && filters.projectId.length > 0) {
      const projects = filters.projectId
        .map((id) => `projectId contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${projects})`);
    }

    // Channel filter
    if (filters.channelId && filters.channelId.length > 0) {
      const channels = filters.channelId
        .map((id) => `channelId contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${channels})`);
    }

    // Sender filter
    if (filters.senderId && filters.senderId.length > 0) {
      const senders = filters.senderId
        .map((id) => `userId contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${senders})`);
    }

    // Participants filter (with:) - user involved in any way (sent, mentioned, thread)
    // Matches userId for direct messages, and threadMentions/threadSenders for thread participation
    if (filters.participants && filters.participants.length > 0) {
      const participantConditions = filters.participants
        .map((id) => {
          const trimmedId = this.escapeYqlValue(id.trim());
          return `(
          userId contains "${trimmedId}" OR
          threadMentions contains "${trimmedId}" OR
          threadSenders contains "${trimmedId}"
        )`;
        })
        .join(' or ');
      conditions.push(`(${participantConditions})`);
    }

    if (filters.createdBefore) {
      const timestamp = parseDateToTimestamp(filters.createdBefore, 'start');
      if (timestamp) conditions.push(`createdAtTimestamp < ${timestamp}`);
    }

    if (filters.createdAfter) {
      const timestamp = parseDateToTimestamp(filters.createdAfter, 'end');
      if (timestamp) conditions.push(`createdAtTimestamp > ${timestamp}`);
    }

    if (filters.createdOn) {
      const rangeStart = parseDateToTimestamp(filters.createdOn, 'start');
      const rangeEnd = parseDateToTimestamp(filters.createdOn, 'end');
      if (rangeStart && rangeEnd) {
        conditions.push(
          `(createdAtTimestamp >= ${rangeStart} and createdAtTimestamp <= ${rangeEnd})`
        );
      }
    }

    // Time keyword filter (today, yesterday, this week, last 7 days, etc.)
    if (filters.createdRange) {
      const timeRange = parseTimeKeyword(filters.createdRange);
      if (timeRange) {
        conditions.push(
          `(createdAtTimestamp >= ${timeRange.from} and createdAtTimestamp <= ${timeRange.to})`
        );
      }
    }
    // Permissions check: user must have explicit permissions OR channel is public.
    // isPrivate exists only on chat_message/chat_container — omit it when the query is
    // pruned to chat_attachment only (else Vespa rejects the field reference).
    const accessClauses: string[] = [`permissions contains "${userId}"`];
    if (this.schemasHaveField(selectedSchemas, (f) => f.isPrivate)) {
      accessClauses.push(`isPrivate contains "false"`);
    }
    conditions.push(`(${accessClauses.join(' or ')})`);
    // messageType exists only on chat_message — omit these clauses when the query is
    // pruned to chat_attachment only (else Vespa rejects the field reference).
    if (this.schemasHaveField(selectedSchemas, (f) => f.messageType)) {
      // Exclude system messages
      conditions.push(`!(messageType contains "SYSTEM")`);

      // Optionally exclude bot messages (cmd-K toggle, default off → exclude)
      if (filters.excludeBotMessages) {
        conditions.push(`!(messageType contains "BOT")`);
      }
    }

    return conditions.join(' and ');
  }

  /**
   * Build YQL condition for Ticket app
   * Applies to ticket schema only
   */
  private buildTicketConditions(filters: TicketFilters, userId: string): string {
    const conditions: string[] = [];

    // DocType filter (always ticket)
    conditions.push(`docType contains "ticket"`);

    // Project filter
    if (filters.projectId && filters.projectId.length > 0) {
      const projects = filters.projectId
        .map((id) => `projectId contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${projects})`);
    } else {
      conditions.push(`permissions contains "${userId}"`);
    }

    // Channel filter
    if (filters.channelId && filters.channelId.length > 0) {
      const channels = filters.channelId
        .map((id) => `channelId contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${channels})`);
    }

    // Status filter
    if (filters.status && filters.status.length > 0) {
      const statuses = filters.status
        .map((s) => `status contains "${this.escapeYqlValue(s.trim().toUpperCase())}"`)
        .join(' or ');
      conditions.push(`(${statuses})`);
    }

    // Ticket ID filter
    if (filters.ticketId && filters.ticketId.length > 0) {
      const tickets = filters.ticketId
        .map((id) => `docId contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${tickets})`);
    }

    if (filters.priority && filters.priority.length > 0) {
      const priorities = filters.priority
        .map((p) => `priority contains "${this.escapeYqlValue(p.trim().toUpperCase())}"`)
        .join(' or ');
      conditions.push(`(${priorities})`);
    }

    // CreatedBy filter (for from: functionality)
    if (filters.createdBy && filters.createdBy.length > 0) {
      const creators = filters.createdBy
        .map((id) => `createdBy contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${creators})`);
    }

    // Board filter (array - comma-separated)
    if (filters.boardId && filters.boardId.length > 0) {
      const boards = filters.boardId
        .map((id) => `boardId contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${boards})`);
    }

    // Tags filter (array)
    if (filters.tags && filters.tags.length > 0) {
      const tagConditions = filters.tags
        .map((tag) => `tags contains "${this.escapeYqlValue(tag.trim())}"`)
        .join(' or ');
      conditions.push(`(${tagConditions})`);
    }

    // Dynamic field filter (fieldId::value tokens)
    if (filters.dynamicFieldValues && filters.dynamicFieldValues.length > 0) {
      const valuesByFieldId = new Map<string, string[]>();
      filters.dynamicFieldValues.forEach((token) => {
        const separatorIndex = token.indexOf('::');
        if (separatorIndex === -1) return;
        const fieldId = token.slice(0, separatorIndex).trim();
        const rawFieldValue = token.slice(separatorIndex + 2).trim();
        const fieldValue =
          rawFieldValue.toLowerCase() === VESPA_MISSING_DYNAMIC_FIELD_VALUE.toLowerCase()
            ? VESPA_MISSING_DYNAMIC_FIELD_VALUE
            : rawFieldValue.toLowerCase();
        if (!fieldId || !fieldValue) return;
        valuesByFieldId.set(fieldId, [...(valuesByFieldId.get(fieldId) ?? []), fieldValue]);
      });
      const dynamicFieldConditions = Array.from(valuesByFieldId.entries())
        .map(([fieldId, fieldValues]) => {
          const uniqueValues = Array.from(new Set(fieldValues));
          const missingRequested = uniqueValues.includes(VESPA_MISSING_DYNAMIC_FIELD_VALUE);
          const concreteValues = uniqueValues.filter(
            (fieldValue) => fieldValue !== VESPA_MISSING_DYNAMIC_FIELD_VALUE
          );
          const valueConditions: string[] = [];

          if (concreteValues.length > 0) {
            const valueClause = concreteValues
              .map((fieldValue) => `fieldValue contains "${this.escapeYqlValue(fieldValue)}"`)
              .join(' or ');
            valueConditions.push(
              `formFields contains sameElement(fieldId contains "${this.escapeYqlValue(fieldId)}" and (${valueClause}))`
            );
          }

          if (missingRequested) {
            valueConditions.push(
              `!(formFields contains sameElement(fieldId contains "${this.escapeYqlValue(fieldId)}"))`
            );
          }

          if (valueConditions.length === 0) return '';
          if (valueConditions.length === 1) return valueConditions[0];
          return `(${valueConditions.join(' or ')})`;
        })
        .join(' and ');
      if (dynamicFieldConditions) {
        conditions.push(`(${dynamicFieldConditions})`);
      }
    }

    if (filters.dynamicFieldDateRanges) {
      const dateConditions = Object.entries(filters.dynamicFieldDateRanges)
        .map(([fieldId, range]) => {
          const effectiveStart =
            range.start ?? (range.end !== undefined ? range.end - (10 * DAY_IN_MS) : undefined);
          const effectiveEnd =
            range.end ?? (range.start !== undefined ? range.start + (10 * DAY_IN_MS) : undefined);

          if (effectiveStart !== undefined && effectiveEnd !== undefined) {
            return `formFields contains sameElement(fieldId contains "${this.escapeYqlValue(fieldId)}" and fieldValueLong >= ${effectiveStart} and fieldValueLong <= ${effectiveEnd})`;
          }
          return '';
        })
        .filter(Boolean)
        .join(' and ');

      if (dateConditions) {
        conditions.push(`(${dateConditions})`);
      }
    }

    // Stage filter
    if (filters.stage && filters.stage.length > 0) {
      const stages = filters.stage
        .map((s) => `stage contains "${this.escapeYqlValue(s.trim().toUpperCase())}"`)
        .join(' or ');
      conditions.push(`(${stages})`);
    }

    // AssignedTo filter (search by ID)
    if (filters.assignedTo && filters.assignedTo.length > 0) {
      const assignees = filters.assignedTo
        .map((id) => `assignedTo contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${assignees})`);
    }

    // Date filters (ISO or dd/mm/yy or dd mon yy - no time keywords)
    if (filters.createdBefore) {
      const timestamp = parseDateToTimestamp(filters.createdBefore, 'start');
      if (timestamp) conditions.push(`createdAtTimestamp < ${timestamp}`);
    }

    if (filters.createdAfter) {
      const timestamp = parseDateToTimestamp(filters.createdAfter, 'end');
      if (timestamp) conditions.push(`createdAtTimestamp > ${timestamp}`);
    }

    if (filters.createdOn) {
      const rangeStart = parseDateToTimestamp(filters.createdOn, 'start');
      const rangeEnd = parseDateToTimestamp(filters.createdOn, 'end');
      if (rangeStart && rangeEnd) {
        conditions.push(
          `(createdAtTimestamp >= ${rangeStart} and createdAtTimestamp <= ${rangeEnd})`
        );
      }
    }

    // Time keyword filter (today, yesterday, this week, last 7 days, etc.)
    if (filters.createdRange) {
      const timeRange = parseTimeKeyword(filters.createdRange);
      if (timeRange) {
        conditions.push(
          `(createdAtTimestamp >= ${timeRange.from} and createdAtTimestamp <= ${timeRange.to})`
        );
      }
    }

    return conditions.join(' and ');
  }

  /**
   * Build YQL condition for collection search
   * Filters file documents where clId (collection ID) is not null/empty
  /**
   * Build YQL condition for SAM Transcript search
   * Applies to sam_transcript schema only
   */
  private buildMeetingConditions(filters: MeetingFilters): string {
    const conditions: string[] = [];

    // DocType filter (always sam_transcript)
    conditions.push(`docType contains "sam_transcript"`);

    // Platform filter
    if (filters.platform && filters.platform.length > 0) {
      const platforms = filters.platform
        .map((p) => `platform contains "${this.escapeYqlValue(p.trim())}"`)
        .join(' or ');
      conditions.push(`(${platforms})`);
    }

    // Merchants filter
    if (filters.merchants && filters.merchants.length > 0) {
      const merchantConditions = filters.merchants
        .map((m) => `merchants contains "${this.escapeYqlValue(m.trim())}"`)
        .join(' or ');
      conditions.push(`(${merchantConditions})`);
    }

    // Type filter
    if (filters.type && filters.type.length > 0) {
      const types = filters.type
        .map((t) => `type contains "${this.escapeYqlValue(t.trim())}"`)
        .join(' or ');
      conditions.push(`(${types})`);
    }

    // Participants filter
    if (filters.participants && filters.participants.length > 0) {
      const participantConditions = filters.participants
        .map((p) => `participants contains "${this.escapeYqlValue(p.trim())}"`)
        .join(' or ');
      conditions.push(`(${participantConditions})`);
    }

    // Date filters
    if (filters.createdBefore) {
      const timestamp = parseDateToTimestamp(filters.createdBefore, 'start');
      if (timestamp) conditions.push(`dateTime < ${timestamp}`);
    }

    if (filters.createdAfter) {
      const timestamp = parseDateToTimestamp(filters.createdAfter, 'end');
      if (timestamp) conditions.push(`dateTime > ${timestamp}`);
    }

    if (filters.createdOn) {
      const rangeStart = parseDateToTimestamp(filters.createdOn, 'start');
      const rangeEnd = parseDateToTimestamp(filters.createdOn, 'end');
      if (rangeStart && rangeEnd) {
        conditions.push(`(dateTime >= ${rangeStart} and dateTime <= ${rangeEnd})`);
      }
    }

    // Time keyword filter (today, yesterday, this week, last 7 days, etc.)
    if (filters.createdRange) {
      const timeRange = parseTimeKeyword(filters.createdRange);
      if (timeRange) {
        conditions.push(`(dateTime >= ${timeRange.from} and dateTime <= ${timeRange.to})`);
      }
    }

    return conditions.join(' and ');
  }

  /**
   * Maps app names to their schemas and returns a mapping
   * @param apps - Array of app names
   * @returns Object mapping app names to their schemas
   */
  getAppSchemaMapping(apps: string[]): Record<AppName, VespaSchema[]> {
    const appGroupMap: Record<AppName, VespaSchema[]> = {
      chat: [messageSchema, channelSchema, attachmentSchema],
      ticket: [ticketSchema],
      user: [userSchema],
      file: [fileSchema],
      collection: [fileSchema],
      transcript: [samTranscriptSchema],
      mail: [mailSchema],
    };

    const result: Record<string, VespaSchema[]> = {};

    for (const app of apps) {
      const appLower = app.toLowerCase() as AppName;
      if (appGroupMap[appLower] && appGroupMap[appLower].length > 0) {
        result[appLower] = appGroupMap[appLower];
      }
    }

    return result as Record<AppName, VespaSchema[]>;
  }

  /**
   * Build YQL condition for mail (Desk) schema.
   * entity = "support_desk" identifies Desk emails (future: "personal" for Gmail).
   * permissions stores channel-participant user IDs — filtered by current user ID.
   */
  private buildMailConditions(filters: MailFilters, userId: string): string {
    const conditions: string[] = [`entity contains "support_desk"`];

    conditions.push(`permissions contains "${userId}"`);

    if (filters.channelId && filters.channelId.length > 0) {
      const channels = filters.channelId
        .map((id) => `channelId contains "${this.escapeYqlValue(id.trim())}"`)
        .join(' or ');
      conditions.push(`(${channels})`);
    }

    if (filters.createdBefore) {
      const timestamp = parseDateToTimestamp(filters.createdBefore, 'start');
      if (timestamp) conditions.push(`timestamp < ${timestamp}`);
    }
    if (filters.createdAfter) {
      const timestamp = parseDateToTimestamp(filters.createdAfter, 'end');
      if (timestamp) conditions.push(`timestamp > ${timestamp}`);
    }
    if (filters.createdOn) {
      const rangeStart = parseDateToTimestamp(filters.createdOn, 'start');
      const rangeEnd = parseDateToTimestamp(filters.createdOn, 'end');
      if (rangeStart && rangeEnd) {
        conditions.push(`(timestamp >= ${rangeStart} and timestamp <= ${rangeEnd})`);
      }
    }
    if (filters.createdRange) {
      const timeRange = parseTimeKeyword(filters.createdRange);
      if (timeRange) {
        conditions.push(`(timestamp >= ${timeRange.from} and timestamp <= ${timeRange.to})`);
      }
    }

    return conditions.join(' and ');
  }

  /**
   * Build Vespa grouping clause
   * @param groupByField - Field to group by
   * @param maxGroups - Maximum number of groups to return
   * @returns Grouping clause string
   */
  private buildGroupingClause(groupByField: string, maxGroups: number = 20): string {
    // Common grouping patterns based on field
    switch (groupByField) {
      case 'channelId':
        // Group by channel, show top results per channel
        return `all(group(channelId) max(${maxGroups}) each(max(5) each(output(summary()))))`;

      case 'docType':
        // Group by document type (messages, channels, attachments, etc.)
        return `all(group(docType) max(10) each(max(10) each(output(summary()))))`;

      case 'senderId':
      case 'userId':
        // Group by sender/user
        return `all(group(userId) max(${maxGroups}) each(max(5) each(output(summary()))))`;

      case 'date':
        // Group by date (requires time buckets)
        return `all(group(time.date(createdAt)) max(30) each(max(10) each(output(summary()))))`;

      case 'hour':
        // Group by hour
        return `all(group(time.hourofday(createdAt)) max(24) each(max(10) each(output(summary()))))`;

      default:
        // Unknown groupBy field — return empty to avoid injecting arbitrary field names
        return '';
    }
  }
}
