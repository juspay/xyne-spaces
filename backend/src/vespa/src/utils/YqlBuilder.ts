import {
  type VespaSchema,
  VespaDocType,
  ticketSchema,
  messageSchema,
  attachmentSchema,
  userSchema,
  channelSchema,
  fileSchema,
} from '../types';
import { parseDateToTimestamp, parseTimeKeyword } from './dateParser';

type AppName = 'chat' | 'ticket' | 'user' | 'file';

export interface SlackFilters {
  channelId?: string[];
  projectId?: string[];
  docType?: string[];
  senderId?: string[];
  // Date filters
  createdBefore?: string;       // Created before date (multiple formats)
  createdAfter?: string;        // Created after date (multiple formats)
  createdOn?: string;           // Created on specific date (multiple formats)
  createdRange?: string;        // Time keyword (today, yesterday, this week, etc.)
}

export interface TicketFilters {
  projectId?: string[];
  channelId?: string[];
  status?: string[];
  ticketId?: string[];
  priority?: string[];            // Filter by priority (HIGH, MEDIUM, LOW) - comma-separated
  createdBy?: string[];         // Filter by ticket creator (for from: functionality)
  // New filters
  boardId?: string[];           // Filter by board ID - comma-separated
  tags?: string[];              // Filter by tags
  createdBefore?: string;       // Created before date (multiple formats)
  createdAfter?: string;        // Created after date (multiple formats)
  createdOn?: string;           // Created on specific date (multiple formats)
  createdRange?: string;        // Time keyword (today, yesterday, this week, etc.)
  stage?: string[];              // Filter by ticket stage - comma-separated
  assignedTo?: string[];        // Filter by assigned user ID - comma-separated
}

export interface FileFilters {
  subApp?: string[];
  docType?: string[];
  createdBefore?: string;
  createdAfter?: string;
  createdOn?: string;
  createdRange?: string;
}

export class YqlBuilder {
  constructor() {}

buildYql(
  query:string,
  schemas: VespaSchema[],
  limit: number,
  apps: string[],
  groupBy: string,
  slackFilters: SlackFilters,
  ticketFilters: TicketFilters,
  fileFilters: FileFilters,
  userId: string,
  useFuzzy: boolean = false,
): string {
  const schemaNames = schemas.join(', ');
  const whereConditions: string[] = [];

  //Build search condition
  if (query && query.trim() && query !== '*') {
      if (useFuzzy) {
        // Fuzzy: use text_fuzzy index
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
      or ({targetHits:${limit}} nearestNeighbor(text_embeddings, e))
      or ({targetHits:${limit}} nearestNeighbor(chunk_embeddings, e))
    )`);
      } else {
        // Standard: no defaultIndex
        whereConditions.push(`(
        (userInput(@query))
      or ({targetHits:${limit}} nearestNeighbor(text_embeddings, e))
      or ({targetHits:${limit}} nearestNeighbor(chunk_embeddings, e))
    )`);
      }
    }
    // Build app-specific conditions
    const appConditions: string[] = [];

    if (apps.some(a => a.toLowerCase() === 'chat')) {
      appConditions.push(this.buildChatConditions(slackFilters , userId));
    }

    if (apps.some(a => a.toLowerCase() === 'ticket')) {
      appConditions.push(this.buildTicketConditions(ticketFilters, userId));
    }

    if (apps.some(a => a.toLowerCase() === 'user')) {
      appConditions.push(this.buildUserConditions());
    }
    if (apps.some(a => a.toLowerCase() === 'file')) {
      appConditions.push(this.buildFileConditions(fileFilters, userId));
    }
     // Combine app conditions
    if (appConditions.length > 0) {
      whereConditions.push(`(${appConditions.join(' or ')})`);
    }
    let yql = `select * from sources ${schemaNames} where ${whereConditions.join(' and ')}`;
     if (groupBy && apps.length!=1) {
      const groupClause = this.buildGroupingClause(groupBy, limit);
      yql += `| ${groupClause}`;
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
    const subApps = filters.subApp && filters.subApp.length > 0
      ? filters.subApp.map(s => s.trim())
      : ['CANVAS', 'TRANSCRIPT', 'CHAT_ATTACHMENT', 'TICKET_ATTACHMENT', 'RCA'];

    // Canvas: require owner/permissions/isPrivate check
    if (subApps.some(s => s === 'CANVAS')) {
      subAppConditions.push(`((subApp contains "CANVAS") and (ownerId contains "${userId}" or permissions contains "${userId}" or isPrivate contains "false"))`);
    }

    // Chat/Ticket/Transcript attachments: require owner/channelPermissions/isPrivate check
    if (subApps.some(s => s === 'CHAT_ATTACHMENT' || s === 'TICKET_ATTACHMENT' || s === 'TRANSCRIPT')) {
      subAppConditions.push(`((subApp contains "CHAT_ATTACHMENT" or subApp contains "TICKET_ATTACHMENT" or subApp contains "TRANSCRIPT") and (ownerId contains "${userId}" or channelPermissions contains "${userId}" or isPrivate contains "false"))`);
    }

    // RCA: no permission check (public)
    if (subApps.some(s => s === 'RCA')) {
      subAppConditions.push(`subApp contains "RCA"`);
    }

    if (subAppConditions.length > 0) {
      conditions.push(`(${subAppConditions.join(' or ')})`);
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
        conditions.push(`(createdAtTimestamp >= ${rangeStart} and createdAtTimestamp <= ${rangeEnd})`);
      }
    }

    // Time keyword filter (today, yesterday, this week, last 7 days, etc.)
    if (filters.createdRange) {
      const timeRange = parseTimeKeyword(filters.createdRange);
      if (timeRange) {
        conditions.push(`(createdAtTimestamp >= ${timeRange.from} and createdAtTimestamp <= ${timeRange.to})`);
      }
    }
    return conditions.join(' and ');
  }
  /**
   * Build YQL condition for Slack app
   * Applies to message, channel, and attachment schemas
   */
private buildChatConditions(filters: SlackFilters, userId: string): string {
    const conditions: string[] = [];
    // DocType filter
    if (filters.docType && filters.docType.length > 0) {
      const docTypes = filters.docType.map(t => `docType contains "${t.trim()}"`).join(' or ');
      conditions.push(`(${docTypes})`);
    } else {
      conditions.push(`(docType contains "${VespaDocType.MESSAGE}" or docType contains "${VespaDocType.ATTACHMENT}")`);
    }

    // Project filter
    if (filters.projectId && filters.projectId.length > 0) {
      const projects = filters.projectId.map(id => `projectId contains "${id.trim()}"`).join(' or ');
      conditions.push(`(${projects})`);
    }

    // Channel filter
    if (filters.channelId && filters.channelId.length > 0) {
      const channels = filters.channelId.map(id => `channelId contains "${id.trim()}"`).join(' or ');
      conditions.push(`(${channels})`);
    }

    // Sender filter
    if (filters.senderId && filters.senderId.length > 0) {
      const senders = filters.senderId.map(id => `userId contains "${id.trim()}"`).join(' or ');
      conditions.push(`(${senders})`);
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
        conditions.push(`(createdAtTimestamp >= ${rangeStart} and createdAtTimestamp <= ${rangeEnd})`);
      }
    }

    // Time keyword filter (today, yesterday, this week, last 7 days, etc.)
    if (filters.createdRange) {
      const timeRange = parseTimeKeyword(filters.createdRange);
      if (timeRange) {
        conditions.push(`(createdAtTimestamp >= ${timeRange.from} and createdAtTimestamp <= ${timeRange.to})`);
      }
    }
    // Exclude system messages
    //Permissions check
    conditions.push(`permissions contains "${userId}"`);
    conditions.push(`!(messageType contains "SYSTEM")`);

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
      const projects = filters.projectId.map(id => `projectId contains "${id.trim()}"`).join(' or ');
      conditions.push(`(${projects})`);
    }else{
      conditions.push(`permissions contains "${userId}"`);
    }

    // Channel filter
    if (filters.channelId && filters.channelId.length > 0) {
      const channels = filters.channelId.map(id => `channelId contains "${id.trim()}"`).join(' or ');
      conditions.push(`(${channels})`);
    }

    // Status filter
    if (filters.status && filters.status.length > 0) {
      const statuses = filters.status.map(s => `status contains "${s.trim().toUpperCase()}"`).join(' or ');
      conditions.push(`(${statuses})`);
    }

    // Ticket ID filter
    if (filters.ticketId && filters.ticketId.length > 0) {
      const tickets = filters.ticketId.map(id => `docId contains "${id.trim()}"`).join(' or ');
      conditions.push(`(${tickets})`);
    }

    if (filters.priority && filters.priority.length > 0) {
      const priorities = filters.priority.map(p => `priority contains "${p.trim().toUpperCase()}"`).join(' or ');
      conditions.push(`(${priorities})`);
    }

    // CreatedBy filter (for from: functionality)
    if (filters.createdBy && filters.createdBy.length > 0) {
      const creators = filters.createdBy.map(id => `createdBy contains "${id.trim()}"`).join(' or ');
      conditions.push(`(${creators})`);
    }

    // Board filter (array - comma-separated)
    if (filters.boardId && filters.boardId.length > 0) {
      const boards = filters.boardId.map(id => `boardId contains "${id.trim()}"`).join(' or ');
      conditions.push(`(${boards})`);
    }

    // Tags filter (array)
    if (filters.tags && filters.tags.length > 0) {
      const tagConditions = filters.tags.map(tag => `tags contains "${tag.trim()}"`).join(' or ');
      conditions.push(`(${tagConditions})`);
    }

    // Stage filter
    if (filters.stage && filters.stage.length > 0) {
      const stages = filters.stage.map(s => `stage contains "${s.trim().toUpperCase()}"`).join(' or ');
      conditions.push(`(${stages})`);
    }

    // AssignedTo filter (search by ID)
    if (filters.assignedTo && filters.assignedTo.length > 0) {
      const assignees = filters.assignedTo.map(id => `assignedTo contains "${id.trim()}"`).join(' or ');
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
        conditions.push(`(createdAtTimestamp >= ${rangeStart} and createdAtTimestamp <= ${rangeEnd})`);
      }
    }

    // Time keyword filter (today, yesterday, this week, last 7 days, etc.)
    if (filters.createdRange) {
      const timeRange = parseTimeKeyword(filters.createdRange);
      if (timeRange) {
        conditions.push(`(createdAtTimestamp >= ${timeRange.from} and createdAtTimestamp <= ${timeRange.to})`);
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
        // Generic grouping by field
        return `all(group(${groupByField}) max(${maxGroups}) each(max(5) each(output(summary()))))`;
    }
  }
}