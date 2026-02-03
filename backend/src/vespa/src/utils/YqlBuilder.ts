import {
  type VespaSchema,
  VespaDocType,
  ticketSchema,
  messageSchema,
  attachmentSchema,
  userSchema,
  channelSchema,
} from '../types';

type AppName = 'chat' | 'ticket' | 'user';

export interface SlackFilters {
  channelId?: string[];
  projectId?: string[];
  docType?: string[];
  senderId?: string[];
}

export interface TicketFilters {
  projectId?: string[];
  channelId?: string[];
  groupId?: string[];
  status?: string[];
  ticketId?: string[];
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

    // Group filter
    if (filters.groupId && filters.groupId.length > 0) {
      const groups = filters.groupId.map(id => `userGroupId contains "${id.trim()}"`).join(' or ');
      conditions.push(`(${groups})`);
    }

    // Status filter
    if (filters.status && filters.status.length > 0) {
      const statuses = filters.status.map(s => `status contains "${s.trim()}"`).join(' or ');
      conditions.push(`(${statuses})`);
    }

    // Ticket ID filter
    if (filters.ticketId && filters.ticketId.length > 0) {
      const tickets = filters.ticketId.map(id => `docId contains "${id.trim()}"`).join(' or ');
      conditions.push(`(${tickets})`);
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