import type { TableName } from './types';
import type { QueryContext } from '../../acl/core/types';
import { BaseVespaHandler } from './base-handler';

// Table-specific handlers - import as they are created
import { MessagesVespaHandler } from '../tables/messages-handler';
import { TicketsVespaHandler } from '../tables/tickets-handler';
import { ChannelsVespaHandler } from '../tables/channels-handler';
import { ProjectsVespaHandler } from '../tables/projects-handler';
import { RCAVespaHandler } from '../tables/rca-handler';
import { CanvasesVespaHandler } from '../tables/canvases-handler';
import { TranscriptsVespaHandler } from '../tables/transcripts-handler';
import { CallParticipantsVespaHandler } from '../tables/call-participants-handler';
import { MessageAttachmentsVespaHandler } from '../tables/message-attachments-handler';
import { ChannelStatsVespaHandler } from '../tables/channel-stats-handler';
import { FormEntityValuesVespaHandler } from '../tables/form-entity-values-handler';
import { AppsVespaHandler } from '../tables/apps-handler';
/**
 * Factory for getting the appropriate Vespa handler for a given table.
 * 
 * Similar to ACLFactory, this provides a centralized mapping from
 * table names to their Vespa injection handlers.
 * 
 * Tables without specific handlers will use BaseVespaHandler,
 * which returns empty arrays (no jobs queued).
 */
export class VespaHandlerFactory {
  /**
   * Get the Vespa handler for a specific table.
   * 
   * @param table - The table name
   * @param ctx - Query context with user info
   * @returns The appropriate handler for the table
   */
  static getHandler(table: TableName, ctx: QueryContext): BaseVespaHandler<any> {
    switch (table) {
      // Chat/messaging tables
      case 'messages':
        return new MessagesVespaHandler(ctx);
      case 'channels':
        return new ChannelsVespaHandler(ctx);
      case 'channel_stats':
        // Channel stats changes can affect the parent channel's indexing in Vespa
        return new ChannelStatsVespaHandler(ctx);

      // Ticketing tables
      case 'tickets':
        return new TicketsVespaHandler(ctx);
      case 'form_entity_values':
        return new FormEntityValuesVespaHandler(ctx);

      // Project tables
      case 'projects':
        return new ProjectsVespaHandler(ctx);
      case "rcas":
        return new RCAVespaHandler(ctx);

      // Canvas tables
      case 'canvases':
        return new CanvasesVespaHandler(ctx);

      // Call tables
      case 'calls':
        return new TranscriptsVespaHandler(ctx);
      case 'call_participants':
        return new CallParticipantsVespaHandler(ctx);

      // File attachments
      case 'message_attachments':
        return new MessageAttachmentsVespaHandler(ctx);

      // xyne-apps catalog
      case 'apps':
        return new AppsVespaHandler(ctx);

      // Default: no Vespa jobs for unhandled tables
      default:
        return new BaseVespaHandler(ctx, table);
    }
  }
}
