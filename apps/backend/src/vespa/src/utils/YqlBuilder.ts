import {
  type VespaSchema,
  VespaDocType,
  RankProfile,
  ticketSchema,
  messageSchema,
  attachmentSchema,
  userSchema,
  channelSchema,
  fileSchema,
  samTranscriptSchema,
  mailSchema,
  appSchema,
  callSchema,
} from '../types';
import { parseDateToTimestamp, parseTimeKeyword } from './dateParser';

type AppName = 'chat' | 'ticket' | 'user' | 'file' | 'collection' | 'transcript' | 'mail' | 'xyneapp' | 'call';

const VESPA_MISSING_DYNAMIC_FIELD_VALUE = '__VESPA_MISSING__';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Fields matched against the raw user query via userInput(@query), kept as one list so the
// grammar annotation (see userInputClause) is defined once instead of per OR-clause.
const LEXICAL_FUZZY_FIELDS = [
  'text_fuzzy', 'username', 'mentionChannelName', 'title', 'description',
  'title_fuzzy', 'description_fuzzy', 'initialMessage_fuzzy', 'eta', 'channelName',
  'boardName', 'xyneId', 'tags', 'createdByName', 'assignedToName', 'closedByName',
  'projectName', 'ticketMentions', 'threadMentions', 'threadSenders',
  'parentTicketXyneId', 'childTicketXyneIds', 'stage', 'status', 'subject_fuzzy', 'chunks_fuzzy',
  'ticketFormFieldValues',
];

// grammar:"tokenize" tokenizes the user query with syntax parsing off (weakAnd/internal/none),
// so operator characters match as plain text. Pass a different grammar (e.g. 'grammar:"all"') to opt out.
const userInputClause = (defaultIndex?: string, grammar = 'grammar:"tokenize"'): string => {
  const annotations = [defaultIndex ? `defaultIndex: "${defaultIndex}"` : null, grammar]
    .filter(Boolean)
    .join(', ');
  return `({${annotations}} userInput(@query))`;
};

export interface SlackFilters {
  channelId?: string[];
  projectId?: string[];
  docType?: string[];
  senderId?: string[];
  participants?: string[]; // Participant filter (user IDs) - matches userId, threadMentions, threadSenders
  // Mention filters (scoped search): messages that mention a user (mentions field, now holds userIds)
  // or reference a channel (channelMentions field). Both are exact attribute membership filters.
  mentionedUserIds?: string[];
  mentionedChannelIds?: string[];
  // Thread classification. threadType lives ONLY on a thread's root message, so filtering it
  // yields one hit per matching thread — "show me the ISSUE threads". messageActs lives on
  // each message the classifier cited as evidence, so filtering that yields the individual
  // messages that justified a tag. Different questions; both exact attribute filters.
  threadType?: string[];
  messageActs?: string[];
  // Date filters
  createdBefore?: string; // Created before date (multiple formats)
  createdAfter?: string; // Created after date (multiple formats)
  createdOn?: string; // Created on specific date (multiple formats)
  createdRange?: string; // Time keyword (today, yesterday, this week, etc.)
  // When true, exclude messages with messageType="BOT" from chat results.
  // Default behavior (when undefined/false) is to INCLUDE bot messages.
  excludeBotMessages?: boolean;
  // When true, scope chat results to channels the user is a member of (drop the
  // public-non-member access branch). Default (undefined/false) includes public channels.
  onlyMyChannels?: boolean;
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
  from?: string[];
  to?: string[];
  createdBefore?: string;
  createdAfter?: string;
  createdOn?: string;
  createdRange?: string;
}

export interface CallFilters {
  docType?: string[];
  channelId?: string[];
  userIds?: string[];
  callId?: string[];
  externalId?: string[];
  callType?: string[];
  status?: string[];
  timeFrom?: number;
  timeTo?: number;
}

/**
 * Collects filter values for Vespa parameter substitution (the prepared-statement pattern):
 * `bind()` returns an `@placeholder` and the value rides as a separate request property, so it
 * is matched as data, never parsed as YQL. Repeated (field, value) pairs reuse one placeholder.
 */
class VespaQueryParams {
  private readonly placeholdersByField = new Map<string, Map<string, string>>();

  /**
   * Bind a value and return its `@placeholder`. Identical (field, value) pairs reuse one
   * placeholder; distinct values of a field get distinct ones.
   */
  bind(fieldName: string, value: string): string {
    let placeholderByValue = this.placeholdersByField.get(fieldName);
    if (!placeholderByValue) {
      placeholderByValue = new Map<string, string>();
      this.placeholdersByField.set(fieldName, placeholderByValue);
    }
    const existing = placeholderByValue.get(value);
    if (existing) {
      return `@${existing}`;
    }

    // The `_` separates name from index so distinct fields never share a placeholder:
    // "channelId" idx 10 -> "channelId_10" can't collide with "channelId1" idx 0 -> "channelId1_0".
    const placeholder = `${fieldName}_${placeholderByValue.size}`;
    placeholderByValue.set(value, placeholder);
    return `@${placeholder}`;
  }

  /** Placeholder -> value map to merge into the Vespa search request payload. */
  toRequestProperties(): Record<string, string> {
    const properties: Record<string, string> = {};
    for (const placeholderByValue of this.placeholdersByField.values()) {
      for (const [value, placeholder] of placeholderByValue) {
        // Values go out raw, never escaped: bound params are matched verbatim by Vespa.
        properties[placeholder] = value;
      }
    }
    return properties;
  }
}

export class YqlBuilder {
  constructor() {}

  // No escapeYqlValue here anymore: every user/dynamic value is bound via VespaQueryParams.bind()
  // as an `@placeholder` parameter, so it never enters the YQL string and needs no escaping.

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
    callFilters: CallFilters = {},
    useFuzzy: boolean = false,
    useSemanticAnyway: boolean = true,
    workspaceId?: string,
    sort?: string,
    useExactMatch: boolean = false,
    rankProfile?: string,
    userEmail?: string,
  ): { yql: string; params: Record<string, string> } {
    const schemaNames = schemas.join(', ');
    // `limit` is interpolated raw into non-bindable YQL grammar ({targetHits:N}, max(N)); coerce to
    // a real number so a non-numeric caller can't inject YQL. Default matches index.ts/the Joi schema.
    const safeLimit = Number.isFinite(limit) ? limit : 20;
    const whereConditions: string[] = [];
    // Collects `@placeholder` parameter bindings for user filter values (see VespaQueryParams).
    const params = new VespaQueryParams();

    //Build search condition
    const isTranscriptOnly = apps.length === 1 && apps[0].toLowerCase() === 'transcript';
    const queryLength = query?.length ?? 0;

    // Optimization: Skip semantic search for short queries (< 3 chars) - lexical only
    const useSemantic = useSemanticAnyway && queryLength > 3;

    if (query && query !== '*') {
      if (useExactMatch) {
        // Exact match: grammar:"phrase" matches the query as a strict adjacent-term phrase over the
        // default fieldset. Needs rules.off on the request (set in searchService) — the deployed
        // searchrules.sr strips stopwords ("is", "the", ...) by default, which silently breaks a
        // phrase when a stopword sits mid-query. No nearestNeighbor / fuzzy — those broaden a match.
        whereConditions.push(userInputClause(undefined, 'grammar:"phrase"'));
      } else if (useFuzzy) {
        // Same user-query fields for both fuzzy branches; grammar:"tokenize" applied per clause.
        const lexicalFieldClauses = LEXICAL_FUZZY_FIELDS.map((field) => userInputClause(field)).join('\n      or ');
        if (useSemantic) {
          // Hybrid: fuzzy lexical + semantic
          whereConditions.push(`(
      ${lexicalFieldClauses}
      or ({targetHits:${safeLimit}} nearestNeighbor(text_embeddings, e))
      or ({targetHits:${safeLimit}} nearestNeighbor(chunk_embeddings, e))
      or ({targetHits:${safeLimit}, approximate:false} nearestNeighbor(combined_embeddings, e))
    )`);
        } else {
          // Lexical only: short query, skip semantic
          whereConditions.push(`(
      ${lexicalFieldClauses}
    )`);
        }
      } else if (isTranscriptOnly) {
        // sam_transcript schema uses its own embedding fields; text_embeddings/chunk_embeddings don't exist on it
        whereConditions.push(`(
        ${userInputClause()}
      or ({targetHits:${safeLimit}} nearestNeighbor(meetingSummary_embeddings, e))
      or ({targetHits:${safeLimit}} nearestNeighbor(chapters_embeddings, e))
      or ({targetHits:${safeLimit}} nearestNeighbor(actionItems_embeddings, e))
      or ({targetHits:${safeLimit}} nearestNeighbor(others_embeddings, e))
      or ({targetHits:${safeLimit}} nearestNeighbor(qna_embeddings, e))
    )`);
      } else {
        // Lexical only: short query
        if (useSemantic) {
          // approximate:false — combined_embeddings' HNSW returns 0 hits under any filter; drop after index rebuild.
          whereConditions.push(`(
          ${userInputClause()}
        or ({targetHits:${safeLimit}} nearestNeighbor(text_embeddings, e))
        or ({targetHits:${safeLimit}} nearestNeighbor(chunk_embeddings, e))
        or ({targetHits:${safeLimit}, approximate:false} nearestNeighbor(combined_embeddings, e))
        )`);
        } else {
          whereConditions.push(userInputClause());
        }
      }

      // `personalized` only: caller as rank-only terms so each profile's involvement tier can
      // read matches(<field>). rank()'s extra args never change what matches; each group is
      // gated on its schema being selected (Vespa rejects fields absent from every source).
      if (rankProfile === RankProfile.personalizedRank && userId) {
        const rankTerms = new Set<string>();
        let meId: string | undefined;
        const me = () => (meId ??= params.bind('involvedUser', userId));
        if (schemas.includes(messageSchema)) {
          rankTerms.add(`userId contains ${me()}`);
          rankTerms.add(`mentions contains ${me()}`);
          rankTerms.add(`threadSenders contains ${me()}`);
          rankTerms.add(`threadMentions contains ${me()}`);
        }
        if (schemas.includes(ticketSchema)) {
          rankTerms.add(`createdBy contains ${me()}`);
          rankTerms.add(`assignedTo contains ${me()}`);
          rankTerms.add(`ticketMentions contains ${me()}`);
          rankTerms.add(`threadMentions contains ${me()}`);
          rankTerms.add(`threadSenders contains ${me()}`);
        }
        if (schemas.includes(fileSchema)) {
          rankTerms.add(`ownerId contains ${me()}`);
          rankTerms.add(`createdBy contains ${me()}`);
        }
        if (schemas.includes(mailSchema) && userEmail) {
          // mail matches by email; `from` is a YQL keyword and must be quoted
          const meEmail = params.bind('involvedEmail', userEmail);
          rankTerms.add(`"from" contains ${meEmail}`);
          rankTerms.add(`to contains ${meEmail}`);
        }
        if (rankTerms.size > 0) {
          whereConditions[0] = `rank(${whereConditions[0]}, ${[...rankTerms].join(', ')})`;
        }
      }
    }
    // Build app-specific conditions.
    // Guarded apps (chat, ticket, file, mail, call) accept user-supplied filter inputs and
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
        `(${this.buildChatConditions(slackFilters, userId, chatSchemas, params)}) and ${this.buildPermGuard(chatSchemas, userId, params, workspaceId)}`
      );
    }

    if (apps.some((a) => a.toLowerCase() === 'ticket')) {
      const ticketSchemas = selectedFor([ticketSchema]);
      guardedParts.push(
        `(${this.buildTicketConditions(ticketFilters, userId, params)}) and ${this.buildPermGuard(ticketSchemas, userId, params, workspaceId)}`
      );
    }

    if (apps.some((a) => a.toLowerCase() === 'file')) {
      const fileSchemas = selectedFor([fileSchema]);
      guardedParts.push(
        `(${this.buildFileConditions(fileFilters, userId, params)}) and ${this.buildPermGuard(fileSchemas, userId, params, workspaceId)}`
      );
    }

    if (apps.some((a) => a.toLowerCase() === 'mail')) {
      const mailSchemas = selectedFor([mailSchema]);
      guardedParts.push(
        `(${this.buildMailConditions(mailFilters, userId, params)}) and ${this.buildPermGuard(mailSchemas, userId, params, workspaceId)}`
      );
    }

    if (apps.some((a) => a.toLowerCase() === 'call')) {
      const callSchemas = selectedFor([callSchema]);
      guardedParts.push(
        `(${this.buildCallConditions(callFilters, params)}) and ${this.buildPermGuard(callSchemas, userId, params, workspaceId)}`
      );
    }

    if (apps.some((a) => a.toLowerCase() === 'user')) {
      openConditions.push(this.buildUserConditions());
    }

    if (apps.some((a) => a.toLowerCase() === 'transcript')) {
      openConditions.push(this.buildMeetingConditions(meetingFilters, params, userId));
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
      whereConditions.push(`workspaceId contains ${params.bind('workspaceId', workspaceId)}`);
    }

    let yql = `select * from sources ${schemaNames} where ${whereConditions.join(' and ')}`;

    // Append ORDER BY when caller requests timestamp-based sorting.
    // Only applies to flat (non-grouped) results — caller must set groupBy='' to get flat output.
    // Field name varies by schema; for multi-app queries we use 'timestamp' (Slack field) since
    // schemas without that field default to 0, naturally sinking non-message results to the bottom.
    if ((sort === 'newest' || sort === 'oldest') && !groupBy) {
      const dir = sort === 'newest' ? 'desc' : 'asc';
      const appsLower = apps.map((a) => a.toLowerCase());
      let sortField: string | null = null;
      if (appsLower.length === 1) {
        if (appsLower[0] === 'chat') sortField = 'timestamp';
        else if (appsLower[0] === 'ticket') sortField = 'createdAtTimestamp';
        else if (appsLower[0] === 'file') sortField = 'createdAt';
      } else if (appsLower.includes('chat')) {
        sortField = 'timestamp';
      }
      if (sortField) {
        yql += ` order by ${sortField} ${dir}`;
      }
    }

    const isMailOnly = apps.length === 1 && apps[0].toLowerCase() === 'mail';

    if (isMailOnly) {
      // Deduplicate mail results by conversation: one result per threadId,
      // keeping the highest-relevance hit within each thread.
      yql += ` | all(group(threadId) max(${safeLimit}) order(-max(relevance())) each(max(1) each(output(summary(default)))))`;
    } else if (groupBy && this.shouldGroup(groupBy, schemas, apps)) {
      const groupClause = this.buildGroupingClause(groupBy, Math.min(safeLimit, 50));
      if (groupClause) {
        yql += `| ${groupClause}`;
      }
    }

    return { yql, params: params.toRequestProperties() };
  }
  /**
   * Build YQL condition for user search
   * Applies to user schemas
   */
  private buildUserConditions(): string {
    // People-search filters only on `docType contains "user"` today — with two known gaps:
    //  1. transformUserToVespa stamps docType='user' on EVERY user (human/BOT/APP alike), so
    //     docType cannot exclude bots/apps. The real discriminator is `userType` (USER/BOT/APP
    //     on the User model) — NOT written to Vespa yet. Write it there, then add
    //     `and userType contains "USER"` here to keep bots/apps out of people-search.
    //  2. The personalization worker creates weight-only stubs with NO docType/docId (it writes
    //     by document key, not identity fields), and pre-middleware users were never ingested —
    //     so those docs won't match this filter. The users schema likely needs a BACKFILL
    //     (partial upsert of docType/userType/workspaceId/name) before people-search is complete.
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
   * - call:            permissions, userIds, createdByUserId, workspaceId
   * `permissions` exists in every schema, so the minimum guard is always non-empty.
   */
  private static readonly SCHEMA_FIELDS: Record<
    string,
    {
      ownerId: boolean;
      channelPermissions: boolean;
      userIds: boolean;
      createdByUserId: boolean;
      isPrivate: boolean;
      messageType: boolean;
    }
  > = {
    [messageSchema]: {
      ownerId: false,
      channelPermissions: false,
      userIds: false,
      createdByUserId: false,
      isPrivate: true,
      messageType: true,
    },
    [channelSchema]: {
      ownerId: true,
      channelPermissions: false,
      userIds: false,
      createdByUserId: false,
      isPrivate: true,
      messageType: false,
    },
    [attachmentSchema]: {
      ownerId: false,
      channelPermissions: false,
      userIds: false,
      createdByUserId: false,
      isPrivate: false,
      messageType: false,
    },
    [ticketSchema]: {
      ownerId: false,
      channelPermissions: false,
      userIds: false,
      createdByUserId: false,
      isPrivate: false,
      messageType: false,
    },
    [fileSchema]: {
      ownerId: true,
      channelPermissions: true,
      userIds: false,
      createdByUserId: false,
      isPrivate: true,
      messageType: false,
    },
    [mailSchema]: {
      ownerId: false,
      channelPermissions: false,
      userIds: false,
      createdByUserId: false,
      isPrivate: false,
      messageType: false,
    },
    [callSchema]: {
      ownerId: false,
      channelPermissions: false,
      userIds: true,
      createdByUserId: true,
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
    params: VespaQueryParams,
    workspaceId?: string
  ): string {
    // The same user id is checked against permissions/ownerId/channelPermissions/userIds/
    // createdByUserId, so bind it once and reuse the placeholder across all clauses.
    const accessUser = params.bind('permissions', userId);
    const accessConditions: string[] = [`permissions contains ${accessUser}`];
    if (this.schemasHaveField(selectedSchemas, (f) => f.ownerId)) {
      accessConditions.push(`ownerId contains ${accessUser}`);
    }
    if (this.schemasHaveField(selectedSchemas, (f) => f.channelPermissions)) {
      accessConditions.push(`channelPermissions contains ${accessUser}`);
    }
    if (this.schemasHaveField(selectedSchemas, (f) => f.userIds)) {
      accessConditions.push(`userIds contains ${accessUser}`);
    }
    if (this.schemasHaveField(selectedSchemas, (f) => f.createdByUserId)) {
      accessConditions.push(`createdByUserId contains ${accessUser}`);
    }
    if (this.schemasHaveField(selectedSchemas, (f) => f.isPrivate)) {
      accessConditions.push(`isPrivate contains "false"`);
    }
    const workspaceClause = workspaceId
      ? ` and workspaceId contains ${params.bind('workspaceId', workspaceId)}`
      : '';
    return `((${accessConditions.join(' or ')})${workspaceClause})`;
  }

  /**
   * Build YQL condition for file search
   * Applies to file schemas
   */
  private buildFileConditions(filters: FileFilters, userId: string, params: VespaQueryParams): string {
    const conditions: string[] = [];
    // The current user's id is checked against ownerId/permissions in the subApp access
    // groups below; bind it once and reuse the placeholder.
    const accessUser = params.bind('permissions', userId);

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
        .map((channelId) => `channelId contains ${params.bind('channelId', channelId.trim())}`)
        .join(' or ');
      conditions.push(`(${channelIds})`);
    }

    // Owner filter (created_by)
    if (filters.ownerId && filters.ownerId.length > 0) {
      const ownerIds = filters.ownerId
        .map((ownerId) => `ownerId contains ${params.bind('ownerId', ownerId.trim())}`)
        .join(' or ');
      conditions.push(`(${ownerIds})`);
    }

    // Canvas: require owner/permissions/isPrivate check
    if (subApps.some((s) => s === 'CANVAS')) {
      subAppConditions.push(
        `((subApp contains "CANVAS") and (ownerId contains ${accessUser} or permissions contains ${accessUser} or isPrivate contains "false"))`
      );
    }

    // Chat/Ticket/Transcript attachments: require owner/channelPermissions/isPrivate check
    if (
      subApps.some(
        (s) => s === 'CHAT_ATTACHMENT' || s === 'TICKET_ATTACHMENT' || s === 'TRANSCRIPT'
      )
    ) {
      subAppConditions.push(
        `((subApp contains "CHAT_ATTACHMENT" or subApp contains "TICKET_ATTACHMENT" or subApp contains "TRANSCRIPT") and (ownerId contains ${accessUser} or channelPermissions contains ${accessUser} or isPrivate contains "false"))`
      );
    }

    // RCA: no permission check (public)
    if (subApps.some((s) => s === 'RCA')) {
      subAppConditions.push(`subApp contains "RCA"`);
    }

    // Collections: require owner/permissions/isPrivate check + project scoping
    if (subApps.some((s) => s === 'collections')) {
      let collectionCondition = `(subApp contains "collections") and (ownerId contains ${accessUser} or permissions contains ${accessUser} or isPrivate contains "false")`;
      if (filters.projectId && filters.projectId.length > 0) {
        const projectCondition = filters.projectId
          .map((projectId) => `projectId contains ${params.bind('projectId', projectId)}`)
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
        .map((collectionId) => `clId contains ${params.bind('clId', collectionId)}`)
        .join(' or ');
      conditions.push(`(${orCondition})`);
    }

    // File ID filter (scope to a specific file/document by its Vespa docId)
    if (filters.fileId && filters.fileId.length > 0) {
      const orCondition = filters.fileId.map(id => `docId contains ${params.bind('docId', id)}`).join(' or ');
      conditions.push(`(${orCondition})`);
    }

    // callType filter (e.g. HEADLESS for recordings)
    if (filters.callType && filters.callType.length > 0) {
      const types = filters.callType
        .map((callType) => `callType contains ${params.bind('callType', callType.trim())}`)
        .join(' or ');
      conditions.push(`(${types})`);
    }

    // createdBy filter (for from: functionality - files uploaded by specific user)
    if (filters.createdBy && filters.createdBy.length > 0) {
      const creators = filters.createdBy
        .map((createdBy) => `createdBy contains ${params.bind('createdBy', createdBy.trim())}`)
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
    selectedSchemas: VespaSchema[],
    params: VespaQueryParams
  ): string {
    const conditions: string[] = [];
    // DocType filter
    if (filters.docType && filters.docType.length > 0) {
      const docTypes = filters.docType
        .map((docType) => `docType contains ${params.bind('docType', docType.trim())}`)
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
        .map((projectId) => `projectId contains ${params.bind('projectId', projectId.trim())}`)
        .join(' or ');
      conditions.push(`(${projects})`);
    }

    // Channel filter
    if (filters.channelId && filters.channelId.length > 0) {
      const channels = filters.channelId
        .map((channelId) => `channelId contains ${params.bind('channelId', channelId.trim())}`)
        .join(' or ');
      conditions.push(`(${channels})`);
    }

    // Sender filter
    if (filters.senderId && filters.senderId.length > 0) {
      const senders = filters.senderId
        .map((senderId) => `userId contains ${params.bind('senderId', senderId.trim())}`)
        .join(' or ');
      conditions.push(`(${senders})`);
    }

    // Participants filter (with:) - user involved in any way (sent, mentioned, thread)
    // Matches userId for direct messages, and threadMentions/threadSenders for thread participation
    if (filters.participants && filters.participants.length > 0) {
      const participantConditions = filters.participants
        .map((participantId) => {
          const participant = params.bind('participant', participantId.trim());
          return `(
          userId contains ${participant} OR
          threadMentions contains ${participant} OR
          threadSenders contains ${participant}
        )`;
        })
        .join(' or ');
      conditions.push(`(${participantConditions})`);
    }

    // Mention filter - messages that mention these user(s) (mentions field holds userIds)
    if (filters.mentionedUserIds && filters.mentionedUserIds.length > 0) {
      const mentionedUsers = filters.mentionedUserIds
        .map((id) => `mentions contains ${params.bind('mentionedUserId', id.trim())}`)
        .join(' or ');
      conditions.push(`(${mentionedUsers})`);
    }

    // Channel-mention filter - messages that reference these channel(s)
    if (filters.mentionedChannelIds && filters.mentionedChannelIds.length > 0) {
      const mentionedChannels = filters.mentionedChannelIds
        .map((id) => `channelMentions contains ${params.bind('mentionedChannelId', id.trim())}`)
        .join(' or ');
      conditions.push(`(${mentionedChannels})`);
    }

    // Thread-type filter - the root messages of threads carrying these types.
    if (filters.threadType && filters.threadType.length > 0) {
      const threadTypes = filters.threadType
        .map((type) => `threadType contains ${params.bind('threadType', type.trim())}`)
        .join(' or ');
      conditions.push(`(${threadTypes})`);
    }

    // Message-act filter - the individual messages the classifier cited as evidence for
    // these types. Separate from threadType on purpose: OR-ing the two would return a
    // thread's root AND its evidence messages as if they were unrelated hits.
    if (filters.messageActs && filters.messageActs.length > 0) {
      const acts = filters.messageActs
        .map((act) => `messageActs contains ${params.bind('messageActs', act.trim())}`)
        .join(' or ');
      conditions.push(`(${acts})`);
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
    const accessClauses: string[] = [`permissions contains ${params.bind('permissions', userId)}`];
    if (!filters.onlyMyChannels && this.schemasHaveField(selectedSchemas, (f) => f.isPrivate)) {
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
  private buildTicketConditions(filters: TicketFilters, userId: string, params: VespaQueryParams): string {
    const conditions: string[] = [];

    // DocType filter (always ticket)
    conditions.push(`docType contains "ticket"`);

    // Project filter
    if (filters.projectId && filters.projectId.length > 0) {
      const projects = filters.projectId
        .map((projectId) => `projectId contains ${params.bind('projectId', projectId.trim())}`)
        .join(' or ');
      conditions.push(`(${projects})`);
    } else {
      conditions.push(`permissions contains ${params.bind('permissions', userId)}`);
    }

    // Channel filter
    if (filters.channelId && filters.channelId.length > 0) {
      const channels = filters.channelId
        .map((channelId) => `channelId contains ${params.bind('channelId', channelId.trim())}`)
        .join(' or ');
      conditions.push(`(${channels})`);
    }

    // Status filter
    if (filters.status && filters.status.length > 0) {
      const statuses = filters.status
        .map((status) => `status contains ${params.bind('status', status.trim().toUpperCase())}`)
        .join(' or ');
      conditions.push(`(${statuses})`);
    }

    // Ticket ID filter
    if (filters.ticketId && filters.ticketId.length > 0) {
      const tickets = filters.ticketId
        .map((ticketId) => `docId contains ${params.bind('docId', ticketId.trim())}`)
        .join(' or ');
      conditions.push(`(${tickets})`);
    }

    if (filters.priority && filters.priority.length > 0) {
      const priorities = filters.priority
        .map((priority) => `priority contains ${params.bind('priority', priority.trim().toUpperCase())}`)
        .join(' or ');
      conditions.push(`(${priorities})`);
    }

    // CreatedBy filter (for from: functionality)
    if (filters.createdBy && filters.createdBy.length > 0) {
      const creators = filters.createdBy
        .map((createdBy) => `createdBy contains ${params.bind('createdBy', createdBy.trim())}`)
        .join(' or ');
      conditions.push(`(${creators})`);
    }

    // Board filter (array - comma-separated)
    if (filters.boardId && filters.boardId.length > 0) {
      const boards = filters.boardId
        .map((boardId) => `boardId contains ${params.bind('boardId', boardId.trim())}`)
        .join(' or ');
      conditions.push(`(${boards})`);
    }

    // Tags filter (array)
    if (filters.tags && filters.tags.length > 0) {
      const tagConditions = filters.tags
        .map((tag) => `tags contains ${params.bind('tags', tag.trim())}`)
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
              .map((fieldValue) => `fieldValue contains ${params.bind('fieldValue', fieldValue)}`)
              .join(' or ');
            valueConditions.push(
              `formFields contains sameElement(fieldId contains ${params.bind('fieldId', fieldId)} and (${valueClause}))`
            );
          }

          if (missingRequested) {
            valueConditions.push(
              `!(formFields contains sameElement(fieldId contains ${params.bind('fieldId', fieldId)}))`
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
          // start/end are interpolated raw below (not bound @params) but arrive from JSON.parse with
          // no numeric validation, so coerce to finite numbers — a non-numeric value would inject YQL.
          const start = Number(range.start);
          const end = Number(range.end);
          const hasStart = Number.isFinite(start);
          const hasEnd = Number.isFinite(end);

          const effectiveStart = hasStart ? start : hasEnd ? end - 10 * DAY_IN_MS : undefined;
          const effectiveEnd = hasEnd ? end : hasStart ? start + 10 * DAY_IN_MS : undefined;

          if (effectiveStart !== undefined && effectiveEnd !== undefined) {
            return `formFields contains sameElement(fieldId contains ${params.bind('fieldId', fieldId)} and fieldValueLong >= ${effectiveStart} and fieldValueLong <= ${effectiveEnd})`;
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
        .map((stage) => `stage contains ${params.bind('stage', stage.trim().toUpperCase())}`)
        .join(' or ');
      conditions.push(`(${stages})`);
    }

    // AssignedTo filter (search by ID)
    if (filters.assignedTo && filters.assignedTo.length > 0) {
      const assignees = filters.assignedTo
        .map((assignedTo) => `assignedTo contains ${params.bind('assignedTo', assignedTo.trim())}`)
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
  private buildMeetingConditions(filters: MeetingFilters, params: VespaQueryParams, userId?: string): string {
    const conditions: string[] = [];

    // DocType filter (always sam_transcript)
    conditions.push(`docType contains "sam_transcript"`);

    // Per-user ACL guard — restrict to meetings where the user has explicit access
    if (userId) {
      conditions.push(`permissions contains ${params.bind('permissions', userId)}`);
    }

    // Platform filter
    if (filters.platform && filters.platform.length > 0) {
      const platforms = filters.platform
        .map((platform) => `platform contains ${params.bind('platform', platform.trim())}`)
        .join(' or ');
      conditions.push(`(${platforms})`);
    }

    // Merchants filter
    if (filters.merchants && filters.merchants.length > 0) {
      const merchantConditions = filters.merchants
        .map((merchant) => `merchants contains ${params.bind('merchants', merchant.trim())}`)
        .join(' or ');
      conditions.push(`(${merchantConditions})`);
    }

    // Type filter
    if (filters.type && filters.type.length > 0) {
      const types = filters.type
        .map((type) => `type contains ${params.bind('type', type.trim())}`)
        .join(' or ');
      conditions.push(`(${types})`);
    }

    // Participants filter
    if (filters.participants && filters.participants.length > 0) {
      const participantConditions = filters.participants
        .map((participant) => `participants contains ${params.bind('participant', participant.trim())}`)
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
   * Build the YQL for searching the xyne-apps catalog (`app` schema).
   *
   * Standalone from the universal multi-source builder: apps have no per-user ACL
   * (visibility is gated by the XYNE-APPS resource permission at the route), so there
   * is no permGuard. Retrieval is purely lexical via userInput over the `default`
   * fieldset (name, description, name_fuzzy, description_fuzzy, creatorName,
   * creatorEmail) — this keeps the match set exact, fully paginatable, and noise-free
   * (so a "slack" search returns only apps that actually contain "slack").
   *
   * Embeddings are NOT used to expand the match set here (an `OR nearestNeighbor`
   * makes Vespa's totalCount unreliable and pads results with non-matching docs).
   * Instead the query embedding (input.query(e)) feeds `closeness` in the
   * default_native rank-profile, so semantics still RE-RANK the lexical matches.
   * Workspace isolation (`workspaceId contains @ws`) is applied when supplied.
   */
  /**
   * Build YQL for the xyne-apps catalog, scoped to one of the three Apps views:
   *   - 'org'         → ORG-scoped apps for the caller's org (orgId + scope=ORG).
   *   - 'marketplace' → GLOBAL apps across all orgs (scope=GLOBAL).
   *   - 'installed'   → apps installed in the caller's workspace (docId in installedAppIds).
   * View scoping is always applied (not flag-gated): Org isolation is a security
   * requirement, and Installed/Marketplace define distinct corpora.
   */
  buildAppYql(opts: {
    view: 'installed' | 'org' | 'marketplace';
    orgId?: string;
    installedAppIds?: string[];
  }): {
    yql: string;
    params: Record<string, string>;
  } {
    const params = new VespaQueryParams();
    const conditions: string[] = [userInputClause()];

    if (opts.view === 'org') {
      if (opts.orgId) {
        conditions.push(`orgId contains ${params.bind('orgId', opts.orgId)}`);
      }
      conditions.push(`scope contains ${params.bind('scope', 'ORG')}`);
    } else if (opts.view === 'marketplace') {
      conditions.push(`scope contains ${params.bind('scope', 'GLOBAL')}`);
    } else {
      // installed: restrict to the caller's workspace installs (resolved from the DB).
      // Vespa `in` operator — one bound param (comma-joined) instead of N OR terms.
      // Keeps the YQL constant-size and Vespa's cost flat regardless of install count
      // (vs an OR-chain whose parse/eval cost grows linearly). App ids are cuids/
      // slugs with no commas, so comma-joining is safe. An empty installed set is
      // short-circuited by the caller (searchApps) before we get here.
      const ids = opts.installedAppIds ?? [];
      conditions.push(`docId in (${params.bind('installedIds', ids.join(','))})`);
    }

    const yql = `select * from sources ${appSchema} where ${conditions.join(' and ')}`;
    return { yql, params: params.toRequestProperties() };
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
      xyneapp: [appSchema],
      call: [callSchema],
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

  private buildCallConditions(
    filters: CallFilters,
    params: VespaQueryParams,
  ): string {
    const conditions: string[] = [
      `docType contains "call"`,
    ];

    if (filters.callType && filters.callType.length > 0) {
      const callTypes = filters.callType
        .map((callType) => `callType contains ${params.bind('callType', callType.trim())}`)
        .join(' or ');
      conditions.push(`(${callTypes})`);
    } else {
      conditions.push(`!(callType contains ${params.bind('callTypeExcluded', 'HEADLESS')})`);
    }

    if (filters.channelId && filters.channelId.length > 0) {
      const channels = filters.channelId
        .map((channelId) => `channelId contains ${params.bind('channelId', channelId.trim())}`)
        .join(' or ');
      conditions.push(`(${channels})`);
    }

    if (filters.userIds && filters.userIds.length > 0) {
      const users = filters.userIds
        .map((filterUserId) => `userIds contains ${params.bind('filterUserIds', filterUserId.trim())}`)
        .join(' or ');
      conditions.push(`(${users})`);
    }

    if (filters.callId && filters.callId.length > 0) {
      const calls = filters.callId
        .map((callId) => `callId contains ${params.bind('callId', callId.trim())}`)
        .join(' or ');
      conditions.push(`(${calls})`);
    }

    if (filters.externalId && filters.externalId.length > 0) {
      const externalIds = filters.externalId
        .map((externalId) => `externalId contains ${params.bind('externalId', externalId.trim())}`)
        .join(' or ');
      conditions.push(`(${externalIds})`);
    }

    if (filters.status && filters.status.length > 0) {
      const statuses = filters.status
        .map((status) => `status contains ${params.bind('callStatus', status.trim())}`)
        .join(' or ');
      conditions.push(`(${statuses})`);
    } else {
      conditions.push(`!(status contains ${params.bind('callStatusExcluded', 'CANCELLED')})`);
    }

    if (Number.isFinite(filters.timeFrom) || Number.isFinite(filters.timeTo)) {
      const timeConditions: string[] = [];
      if (Number.isFinite(filters.timeTo)) {
        timeConditions.push(`startsAtTimestamp < ${Math.trunc(filters.timeTo!)}`);
      }
      if (Number.isFinite(filters.timeFrom)) {
        timeConditions.push(`endsAtTimestamp > ${Math.trunc(filters.timeFrom!)}`);
      }
      conditions.push(`(${timeConditions.join(' and ')})`);
    }

    return conditions.join(' and ');
  }

  /**
   * Build YQL condition for mail (Desk) schema.
   * entity = "support_desk" identifies Desk emails (future: "personal" for Gmail).
   * permissions stores channel-participant user IDs — filtered by current user ID.
   */
  private buildMailConditions(filters: MailFilters, userId: string, params: VespaQueryParams): string {
    const conditions: string[] = [`entity contains "support_desk"`];

    conditions.push(`permissions contains ${params.bind('permissions', userId)}`);

    if (filters.channelId && filters.channelId.length > 0) {
      const channels = filters.channelId
        .map((channelId) => `channelId contains ${params.bind('channelId', channelId.trim())}`)
        .join(' or ');
      conditions.push(`(${channels})`);
    }

    const buildPeopleClause = (field: 'from' | 'to', emails: string[]): string =>
      emails
        .map(
          (email) =>
            `({defaultIndex:"${field}", grammar:"all"}userInput(${params.bind(field, email.trim())}))`,
        )
        .join(' or ');

    if (filters.from && filters.from.length > 0) {
      conditions.push(`(${buildPeopleClause('from', filters.from)})`);
    }

    if (filters.to && filters.to.length > 0) {
      conditions.push(`(${buildPeopleClause('to', filters.to)})`);
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
   * Schemas that declare the field each supported groupBy value targets (imported
   * fields included). Vespa rejects grouping on a field absent from every selected
   * source, so a grouping clause may only be emitted when at least one of the
   * `from sources` schemas has the field. Verified against vespa-core/vespa/schemas/*.sd:
   *   senderId / userId -> userId    : chat_message, chat_attachment
   *   channelId         -> channelId : chat_message, chat_attachment, ticket, file, mail
   *                                    (imported as channelRef.docId)
   *   docType           -> docType   : every schema ('all')
   *   date / hour       -> createdAt : every schema except mail (mail uses `timestamp`)
   *   threadType        -> threadType: chat_message only, and only on a thread's ROOT
   *                                    message — so one group entry is one thread, with no
   *                                    dedupe needed
   */
  private static readonly GROUP_FIELD_SCHEMAS: Record<string, VespaSchema[] | 'all'> = {
    senderId: [messageSchema, attachmentSchema],
    userId: [messageSchema, attachmentSchema],
    channelId: [messageSchema, attachmentSchema, ticketSchema, fileSchema, mailSchema],
    docType: 'all',
    threadType: [messageSchema],
    date: [messageSchema, channelSchema, attachmentSchema, ticketSchema, fileSchema, userSchema],
    hour: [messageSchema, channelSchema, attachmentSchema, ticketSchema, fileSchema, userSchema],
  };

  /**
   * True when groupBy's target field exists in at least one selected source.
   * Unknown/unsupported groupBy values return false (no grouping emitted).
   */
  private groupFieldAvailable(groupBy: string, selectedSchemas: VespaSchema[]): boolean {
    const allowed = YqlBuilder.GROUP_FIELD_SCHEMAS[groupBy];
    if (!allowed) return false;
    if (allowed === 'all') return true;
    return selectedSchemas.some((s) => allowed.includes(s));
  }

  /**
   * Decide whether a grouping clause should be emitted.
   * Gated on field presence (see GROUP_FIELD_SCHEMAS) so we never reference a field
   * absent from every selected source. `docType` is the implicit default groupBy
   * (searchService applies it when the caller omits one); a single-app query collapses
   * to essentially one docType, so those results stay flat. An explicit field grouping
   * (senderId / channelId / ...) is honored even for a single app — this fixes the prior
   * footgun where a single app/type + groupBy silently dropped the grouping entirely.
   */
  private shouldGroup(groupBy: string, selectedSchemas: VespaSchema[], apps: string[]): boolean {
    if (!this.groupFieldAvailable(groupBy, selectedSchemas)) return false;
    if (groupBy === 'docType') return apps.length !== 1;
    return true;
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

      case 'threadType':
        // Counts only — no `each(...)` emitting summaries. This answers "how many threads
        // carry each tag" for the whole vocabulary in ONE round trip; asking per name would
        // be a query per candidate on a page that lists them all.
        //
        // threadType lives only on a thread's root message, so a group's count IS a thread
        // count with no dedupe.
        return `all(group(threadType) max(${maxGroups}) each(output(count(), max(createdAtTimestamp))))`;

      default:
        // Unknown groupBy field — return empty to avoid injecting arbitrary field names
        return '';
    }
  }
}
