import type { Schema } from '@xyne/shared';
import type { TableName } from '../acl/core/types';
import {
  SIDE_EFFECT_OPERATION_CONFIG,
  type SideEffectJobsAccumulator,
  type SideEffectOperation,
} from './types';
import { DeleteID, Transaction } from '@rocicorp/zero';
import { zql } from '../queries';
import {logger} from '@/utils/logger';

type TableSchema<TTable extends TableName> = Schema['tables'][TTable];

export async function collectSideEffectJobs(
  table: TableName,
  operation: SideEffectOperation,
  args: any,
  tx: Transaction<Schema>,
  accumulator: SideEffectJobsAccumulator
): Promise<void> {
  const operations = SIDE_EFFECT_OPERATION_CONFIG[table];
  if (!operations || !operations.includes(operation)) {
    return;
  }
  const entityId = extractEntityId(table, args);
  if (!entityId) {
    logger.warn(`[SideEffectCollector] No entity ID found for table '${table}' operation '${operation}'`);
    return;
  }

  let previousValue: any = null;
  if (operation === 'delete' && table === 'reactions') {
    const reaction = await tx.run(zql.reactions.where('reactionId', entityId).one());
    if (reaction) {
      previousValue = {
        messageId: reaction.messageId,
        emojiName: reaction.emojiName,
        userId: reaction.userId,
      };
    }
  }

  if (operation === 'delete' && table === 'messages') {
    const message = await tx.run(zql.messages.where('messageId', entityId).one());
    if (message) {
      previousValue = {
        messageId: message.messageId,
        conversationId: message.conversationId,
        senderId: message.senderId,
        msgType: message.msgType,
      };
    }
  }
  if (operation === 'delete' && table === 'conversations') {
    const entity = await tx.run(zql.conversations.where('conversationId', entityId).one());
    if (entity) {
      previousValue = {
        channelId: entity.channelId,
      };
    }
  }
  if ((operation === 'update' || operation === 'delete') && table === 'delayed_messages') {
    const entity = await tx.run(zql.delayed_messages.where('id', entityId).one());
    if (entity) {
      previousValue = {
        scheduledFor: entity.scheduledFor,
        status: entity.status,
      };
    }
  }
  if (operation === 'delete' && table === 'ticket_tags') {
    const tag = await tx.run(zql.ticket_tags.where('id', entityId).one());
    if (tag) {
      previousValue = {
        tagName: tag.name,
        ticketId: tag.ticketId,
      };
    }
  }

  // Capture previous ticket state for update operations
  if (operation === 'update' && table === 'tickets') {
    const entity = await tx.run(zql.tickets.where('id', entityId).one());
    if (entity) {
      previousValue = {
        assignedTo: entity.assignedTo,
        stageName: entity.stageName,
        statusV2: entity.statusV2,
        priority: entity.priority,
        title: entity.title,
        description: entity.description,
        eta: entity.eta,
        boardId: entity.boardId,
        userGroupId: entity.userGroupId,
        createdBy: entity.createdBy,
        channelId: entity.channelId,
      };
    }
  }

  // Capture previous channel state for update operations
  if (operation === 'update' && table === 'channels') {
    const entity = await tx.run(zql.channels.where('id', entityId).one());
    if (entity) {
      previousValue = {
        name: entity.name,
        scopeType: entity.scopeType,
      };
    }
  }

  if (operation === 'update' && table === 'email_reads') {
    const entity = await tx.run(zql.email_reads.where('id', entityId).one());
    if (entity) {
      previousValue = {
        lastReadEmailId: entity.lastReadEmailId,
      };
    }
  }

  if (operation === 'update' && table === 'channel_user_status') {
    const entity = await tx.run(zql.channel_user_status.where('id', entityId).one());
    if (entity) {
      previousValue = {
        lastViewedAt: entity.lastViewedAt,
        unreadCount: entity.unreadCount,
        channelId: entity.channelId,
        userId: entity.userId,
      };
    }
  }

  if (operation === 'update' && table === 'conversation_participants') {
    const entity = await tx.run(zql.conversation_participants.where('id', entityId).one());
    if (entity) {
      previousValue = {
        lastReadAt: entity.lastReadAt,
        conversationId: entity.conversationId,
        userId: entity.userId,
      };
    }
  }

  accumulator.push({
    entityType: table,
    entityId,
    operation,
    args,
    previousValue,
  });
}

function extractEntityId(table: TableName, args: any): string | null {
  if (!args || typeof args !== 'object') {
    return null;
  }

  switch (table) {
    case 'messages': {
      const typedArgs = args as DeleteID<TableSchema<'messages'>>;
      typedArgs
      return typedArgs.messageId;
    }
    case 'reactions': {
      const typedArgs = args as DeleteID<TableSchema<'reactions'>>;
      return typedArgs.reactionId;
    }
    case 'conversations': {
      const typedArgs = args as DeleteID<TableSchema<'conversations'>>;
      return typedArgs.conversationId;
    }
    case 'reaction_counts': {
      const typedArgs = args as DeleteID<TableSchema<'reaction_counts'>>;
      return typedArgs.countId;
    }
    case 'organizations': {
      const typedArgs = args as DeleteID<TableSchema<'organizations'>>;
      return typedArgs.orgId;
    }
    case 'org_members': {
      const typedArgs = args as DeleteID<TableSchema<'org_members'>>;
      return typedArgs.memberId;
    }

    case 'agents':
    case 'models':
    case 'tools':
    case 'agent_tools_mappings':
    case 'tickets':
    case 'sub_tickets':
    case 'ticket_sub_ticket_mappings':
    case 'ticket_activities':
    case 'ticket_assignments':
    case 'ticket_stage_eta':
    case 'ticket_entity_mappings':
    case 'ticket_reference_mappings':
    case 'ticket_tags':
    case 'projects':
    case 'boards':
    case 'stages':
    case 'user_group_mappings':
    case 'workflows':
    case 'workflow_executions':
    case 'user_groups':
    case 'users':
    case 'user_presence':
    case 'user_profiles':
    case 'resources':
    case 'resource_access':
    case 'pull_requests':
    case 'channels':
    case 'channel_participants':
    case 'channel_user_status':
    case 'conversation_participants':
    case 'message_attachments':
    case 'activities':
    case 'notification_preferences':
    case 'call_participants':
    case 'canvas_participants':
    case 'bookmarks':
    case 'calls':
    case 'delayed_messages':
    case 'draft_messages':
    case 'user_assignment_states':
    case 'board_complexity_scores':
    case 'user_workload_mappings':
    case 'user_expertise_mappings':
    case 'canvases':
    case 'emails':
    case 'repos':
    case 'forms':
    case 'form_fields':
    case 'forms_context_mapping':
    case 'email_drafts':
    case 'email_reads':
    case 'form_entity_values':
    case 'ticket_reference_mappings':
    case 'ticket_tags':
    case 'dashboards':
    case 'queries':
    case 'dashboard_queries_mapping':
    case 'stage_pr_status_mappings':
    case 'links':
    case 'link_access': {
      const typedArgs = args as { id: string };
      return typedArgs.id;
    }
    default: {
      return null;
    }
  }
}
