import { createBuilder, defineQueries } from '@rocicorp/zero';
import {
  CanvasVisibility,
  defineQuery,
  DocType,
  FormContextType,
  FormEntityType,
  LookupType,
} from '@xyne/shared';
import { z } from 'zod';
import {
  ChannelVisibility,
  CallStatus,
  ChannelScopeType,
  ConversationParticipation,
  schema,
  ChannelRole,
  AttachmentEntityType,
  ChannelType,
  ActivityClassification,
} from '@xyne/shared';

export const zql = createBuilder(schema);

export const queries = defineQueries({
  // Conversation and Message Queries
  channelConversations: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .orderBy('createdAt', 'asc')
        .related('initialMessage', (initialMessageQuery) =>
          initialMessageQuery
            .where(({ or, cmp }) =>
              or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
            )
            .related('reactions')
            .related('reactionCounts')
            .related('attachments')
        )
        .related('parentMessage')
        .related('participants', (participantQuery) =>
          participantQuery
            .where('participationType', ConversationParticipation.AUTHOR)
            .orderBy('joinedAt', 'asc')
        )
        .related('ticket');
    }
  ),

  conversationMessages: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ ctx, args: { conversationId } }) => {
      return zql.messages
        .where('conversationId', conversationId)
        .where(({ or, cmp }) => or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)))
        .orderBy('createdAt', 'asc')
        .related('attachments')
        .related('reactionCounts')
        .related('reactions');
    }
  ),

  messageNudges: defineQuery(
    z.object({
      messageId: z.string(),
      states: z.array(z.string()).optional(),
    }),
    ({ ctx, args: { messageId, states } }) => {
      const effectiveStates = states && states.length > 0 ? states : ['ACTIVE'];
      let query = zql.proactive_nudges.where('messageId', messageId);
      if (effectiveStates.length === 1) {
        const singleState = effectiveStates[0];
        if (singleState) {
          query = query.where('state', singleState);
        }
      } else if (effectiveStates.length > 1) {
        query = query.where(helpers =>
          helpers.or(...effectiveStates.map(value => helpers.cmp('state', '=', value)))
        );
      }

      return query
        .whereExists('message', (m) =>
          m
            .where(({ or, cmp }) =>
              or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
            )
            .whereExists('conversation', (c) =>
              c.whereExists('channel', (ch) =>
                ch.where((helpers) =>
                  helpers.or(
                    helpers.cmp('visibility', ChannelVisibility.PUBLIC),
                    helpers.and(
                      helpers.cmp('visibility', ChannelVisibility.PRIVATE),
                      helpers.exists('participants', (p) => p.where('userId', ctx.userID))
                    )
                  )
                )
              )
            )
        )
        .orderBy('createdAt', 'asc');
    }
  ),
  getConversationById: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ ctx, args: { conversationId } }) => {
      return zql.conversations
        .where('conversationId', conversationId)
        .related('initialMessage', (im) =>
          im.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
          )
        )
        .related('parentMessage')
        .related('participants')
        .related('ticket')
        .one();
    }
  ),
  getConversationByTimestamp: defineQuery(
    z.object({ channelId: z.string(), timestamp: z.number() }),
    ({ args: { channelId, timestamp } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .where('createdAt', '<=', timestamp)
        .orderBy('createdAt', 'desc')
        .orderBy('conversationId', 'desc')
        .limit(1)
        .one();
    }
  ),

  allTickets: defineQuery(() => {
    return zql.tickets
      .orderBy('createdAt', 'desc')
      .related('project')
      .related('assignments')
      .related('stageEtaEntries');
  }),

  workflowsPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), createdAt: z.number() }).nullable(),
      searchQuery: z.string().optional(),
      statusFilter: z.array(z.string()).optional(),
      workflowTypeFilter: z.array(z.string()).optional(),
      createdByFilter: z.array(z.string()).optional(),
      assignedToFilter: z.array(z.string()).optional(),
      dateRangeFilter: z
        .object({ startDate: z.number(), endDate: z.number() })
        .optional(),
    }),
    ({ args: { limit, start, searchQuery, statusFilter, workflowTypeFilter, createdByFilter, assignedToFilter, dateRangeFilter } }) => {
      let query = zql.workflows;

      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim();
        query = query.where((helpers) =>
          helpers.or(
            helpers.exists('ticket', (ticket) =>
              ticket.where('title', 'ILIKE', `%${q}%`)
            ),
            helpers.exists('ticket', (ticket) =>
              ticket.where('xyneId', 'ILIKE', `%${q}%`)
            ),
            helpers.cmp('workflowName', 'ILIKE', `%${q}%`)
          )
        );
      }

      if (statusFilter && statusFilter.length > 0) {
        query = query.where('status', 'IN', statusFilter);
      }

      if (workflowTypeFilter && workflowTypeFilter.length > 0) {
        query = query.where('workflowType', 'IN', workflowTypeFilter);
      }

      if (createdByFilter && createdByFilter.length > 0) {
        query = query.whereExists('ticket', (ticket) => ticket.where('createdBy', 'IN', createdByFilter));
      }

      if (assignedToFilter && assignedToFilter.length > 0) {
        query = query.whereExists('ticket', (ticket) => ticket.where('assignedTo', 'IN', assignedToFilter));
      }

      if (dateRangeFilter) {
        query = query.where('createdAt', '>=', dateRangeFilter.startDate).where('createdAt', '<=', dateRangeFilter.endDate);
      }

      query = query.orderBy('createdAt', 'desc');

      if (start) {
        query = query.start({ id: start.id, createdAt: start.createdAt }, { inclusive: false });
      }

      return query.limit(limit).related('ticket');
    }
  ),

  ticketsForEmailChannels: defineQuery(() => {
    return zql.tickets
      .whereExists('conversation', (conversation) =>
        conversation.whereExists('channel', (channel) => channel.where('type', ChannelType.EMAIL))
      )
      .orderBy('createdAt', 'desc')
      .related('project')
      .related('tags')
      .related('entity')
      .related('conversation');
  }),

  // Unified query for Xyne Desk: filters by EMAIL channels with optional channel and merchant filters
  supportTicketsFiltered: defineQuery(
    z.object({
      channelId: z.string().optional(),
      merchantMid: z.string().optional(),
    }).optional(),
    ({ args }) => {
      let query = zql.tickets;

      // If specific channelId provided (from email channels dropdown), use direct filter
      // Otherwise, filter by EMAIL channel type to get all email support tickets
      if (args?.channelId) {
        query = query.where('channelId', args.channelId);
      } else {
        query = query.whereExists('channel', (channel) => channel.where('type', ChannelType.EMAIL));
      }

      // Apply merchant filter using direct merchantId field
      if (args?.merchantMid) {
        query = query.where('merchantId', args.merchantMid);
      }

      return query
        .orderBy('createdAt', 'desc')
        .related('project')
        .related('tags')
        .related('entity')
        .related('conversation', (c) => c.related('channel'));
    }
  ),

  // Get all merchants for Xyne Desk dropdown (simple indexed query on small table)
  getAllMerchants: defineQuery(() => {
    return zql.merchants.orderBy('mid', 'asc');
  }),

  getEmailsForTicket: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ args: { conversationId } }) => {
      return zql.emails.where('conversationId', conversationId);
    }
  ),

  getDraftForConversation: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ args: { conversationId } }) => {
      return zql.email_drafts.where('conversationId', conversationId);
    }
  ),

  ticketById: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.tickets
      .where('id', ticketId)
      .related('project')
      .related('tags')
      .related('referencesOut', (ref) => ref.related('targetTicket'))
      .related('referencesIn', (ref) => ref.related('sourceTicket'))
      .related('entity')
      .related('conversation')
      .related('stageEtaEntries')
      .related('ticketStageRequests', a => a.related('form'))
      .one();
  }),

  ticketByXyneId: defineQuery(z.object({ xyneId: z.string() }), ({ args: { xyneId } }) => {
    return zql.tickets
      .where('xyneId', xyneId)
      .related('project')
      .related('tags')
      .related('referencesOut', (ref) => ref.related('targetTicket'))
      .related('referencesIn', (ref) => ref.related('sourceTicket'))
      .related('entity')
      .related('conversation')
      .one();
  }),

  ticketsByIds: defineQuery(
    z.object({ ticketIds: z.array(z.string()) }),
    ({ args: { ticketIds } }) => {
      return zql.tickets.where((helpers) => helpers.cmp('id', 'IN', ticketIds));
    }
  ),

  getWorkflowForTicket: defineQuery(
    z.object({ ticketId: z.string() }),
    ({ args: { ticketId } }) => {
      return zql.workflows
        .where('ticketId', ticketId)
        .related('workflowExecutions', (executionQuery) =>
          executionQuery.orderBy('createdAt', 'asc')
        )
        .orderBy('createdAt', 'asc');
    }
  ),

  subTicketsForTicket: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.ticket_sub_ticket_mappings
      .where('ticketId', ticketId)
      .related('subTicket', (subTicketQuery) =>
        subTicketQuery.related('conversation').related('mappedTicket')
      )
      .orderBy('id', 'asc');
  }),

  subTicketsByMappedTicketId: defineQuery(
    z.object({ mappedTicketId: z.string() }),
    ({ args: { mappedTicketId } }) => {
      return zql.sub_tickets.where('mappedTicketId', mappedTicketId).related('ticketMappings');
    }
  ),

  ticketAssignmentsByTicketId: defineQuery(
    z.object({ ticketId: z.string() }),
    ({ args: { ticketId } }) => {
      return zql.ticket_assignments.where('ticketId', ticketId);
    },
  ),

  userAllChannels: defineQuery(() => {
    return zql.channels;
  }),

  userVisibleChannels: defineQuery(({ ctx }) => {
    return zql.channels.whereExists('participantsStatus', (p) =>
      p.where('isClosed', false).where('userId', ctx.userID)
    );
  }),

  browsableChannels: defineQuery(({ ctx }) => {
    return zql.channels
      .where((helpers) => {
        return helpers.and(
          // Only regular channels (not DMs)
          helpers.cmp('scopeType', ChannelScopeType.DEFAULT),
          // Public channels OR private channels user is a member of
          helpers.or(
            helpers.cmp('visibility', ChannelVisibility.PUBLIC),
            helpers.and(
              helpers.cmp('visibility', ChannelVisibility.PRIVATE),
              helpers.exists('participants', (p) => p.where('userId', ctx.userID))
            )
          )
        );
      })
      .related('participants')
      .orderBy('name', 'asc');
  }),

  channelParticipants: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.channel_participants.where('channelId', channelId);
    }
  ),
  userConversationsPaginated: defineQuery(
    z.object({
      userId: z.string(),
      limit: z.number(),
      start: z.object({ lastActivityAt: z.number(), id: z.string() }).nullable(),
    }),
    ({ args: { userId, limit, start } }) => {
      let query = zql.conversations
        .where('replyCount', '>', 0)
        .whereExists('participants', (participantsQuery) =>
          participantsQuery.where('userId', userId)
        )
        .orderBy('lastActivityAt', 'desc');

      if (start) {
        query = query.start(
          { lastActivityAt: start.lastActivityAt, conversationId: start.id },
          { inclusive: false }
        );
      }
      return query.limit(limit);
    }
  ),
  searchUserGroups: defineQuery(
    z.object({ query: z.string(), limit: z.number().nullable() }),
    ({ args: { query, limit } }) => {
      return zql.user_groups
        .where(({ or, cmp }) =>
          or(cmp('name', 'ILIKE', `%${query}%`), cmp('alias', 'ILIKE', `%${query}%`))
        )
        .limit(Math.min(limit ?? 10, 15)) // Max 15 results like backend
        .orderBy('name', 'asc')
        .related('userGroupMappings'); // Include for member count
    }
  ),

  getUserMultipleChannelParticipations: defineQuery(
    z.object({ channelIds: z.array(z.string()) }),
    ({ ctx, args: { channelIds } }) => {
      if (channelIds.length === 0) {
        // Return empty query if no channel IDs provided
        return zql.channel_user_status.where('channelId', 'nonexistent').limit(0);
      }

      return zql.channel_user_status.where('userId', ctx.userID).where((helpers) => {
        return helpers.cmp('channelId', 'IN', channelIds);
      });
    }
  ),

  userCanvases: defineQuery(
    z.object({ includeQuartoDocs: z.boolean().optional() }).optional(),
    ({ ctx, args }) => {
      let query = zql.canvases.where((helpers) => {
        return helpers.or(
          helpers.cmp('createdBy', ctx.userID),
          helpers.exists('participants', (p) => p.where('userId', ctx.userID))
        );
      });
      if (!args?.includeQuartoDocs) {
        query = query.where((helpers) =>
          helpers.or(helpers.cmp('docType', DocType.Canvas), helpers.cmp('docType', 'IS', null))
        );
      }

      return query.orderBy('updatedAt', 'desc').related('participants').related('channel');
    }
  ),

  // Query for user's Quarto docs
  userQuartoDocs: defineQuery(({ ctx }) => {
    return zql.canvases
      .where('docType', DocType.Quarto)
      .where((helpers) => {
        return helpers.or(
          helpers.cmp('createdBy', ctx.userID),
          helpers.exists('participants', (p) => p.where('userId', ctx.userID))
        );
      })
      .orderBy('updatedAt', 'desc')
      .related('participants')
      .related('channel');
  }),

  getUsers: defineQuery(() => {
    return zql.users.related('presenceStatus');
  }),

  getUserProfile: defineQuery(z.object({ userId: z.string() }), ({ args: { userId } }) => {
    return zql.user_profiles.where('userId', userId).one();
  }),

  getUserGroupsByIds: defineQuery(
    z.object({ groupIds: z.array(z.string()) }),
    ({ args: { groupIds } }) => {
      if (groupIds.length === 0) {
        // Return empty query if no group IDs provided
        return zql.user_groups.where('id', 'nonexistent').limit(0);
      }

      return zql.user_groups.where('id', 'IN', groupIds).related('userGroupMappings');
    }
  ),

  getAllChannelsUserStatus: defineQuery(({ ctx }) => {
    return zql.channel_user_status.where('userId', ctx.userID);
  }),

  userActiveCalls: defineQuery(() => {
    return zql.calls
      .where('status', CallStatus.ACTIVE)
      .orderBy('startedAt', 'desc')
      .related('participants');
  }),

  userCallHistory: defineQuery(() => {
    return zql.calls.orderBy('startedAt', 'desc').limit(100).related('participants');
  }),
  userActivities: defineQuery(() => {
    return zql.activities
      .orderBy('createdAt', 'desc')
      .related('message', (m) =>
        m
          .related('conversation')
          .related('reactions')
          .related('reactionCounts')
          .related('attachments')
      )
      .related('reaction')
      .related('ticket');
  }),

  userMissedCalls: defineQuery(({ ctx }) => {
    return zql.activities
      .where('userId', ctx.userID)
      .where('actorAction', 'missed_call')
      .where('isRead', false);
  }),

  userUnreadActivities: defineQuery(() => {
    return zql.activities.where('isRead', false).orderBy('createdAt', 'desc').related('channel');
  }),

  userActivitiesPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), createdAt: z.number() }).nullable(),
      types: z.array(z.string()),
      classification: z.array(z.nativeEnum(ActivityClassification)).optional(),
    }),
    ({ args: { limit, start, types, classification } }) => {
      let query = zql.activities;

      if (types.length > 0) {
        query = query.where('actorAction', 'IN', types);
      }

      if (classification && classification.length > 0) {
        query = query.where('classification', 'IN', classification);
      }

      query = query.orderBy('createdAt', 'desc').orderBy('id', 'desc');

      if (start) {
        query = query.start({ id: start.id, createdAt: start.createdAt }, { inclusive: false });
      }

      return query
        .limit(limit)
        .related('message', (m) =>
          m
            .related('conversation')
            .related('reactions')
            .related('reactionCounts')
            .related('attachments')
        )
        .related('reaction')
        .related('ticket');
    }
  ),

  // Get unread thread activities excluding @channel or @here mentions
  userUnreadThreadActivities: defineQuery(() => {
    return zql.activities
      .where('isRead', false)
      .where('actionSource', 'message')
      .whereExists('message', (m) =>
        m.whereExists('conversation', (c) => c.where('replyCount', '>', 0))
      );
  }),

  getMessageForActivity: defineQuery(
    z.object({ messageId: z.string() }),
    ({ args: { messageId } }) => {
      return zql.messages
        .where('messageId', messageId)
        .related('conversation')
        .related('reactions')
        .related('reactionCounts')
        .related('attachments')
        .one();
    }
  ),

  projectById: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) =>
    zql.projects.where('id', projectId).one()
  ),

  ticketsByProject: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) =>
    zql.tickets.where('projectId', projectId).related('tags').orderBy('createdAt', 'desc')
  ),


  boardsByProject: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) => {
    return zql.boards
      .where('projectId', projectId)
      .orderBy('createdAt', 'asc')
      .related('stages', (stagesQuery) =>
        stagesQuery
          .orderBy('sequenceNumber', 'asc')
          .related('prStatusMappings')
          .related('formContextMappings')
          .related('approvers'),
      )
      .related('formContextMappings', mappingQuery =>
        mappingQuery.related('formFields')
      );
  }),

  stagesByBoard: defineQuery(z.object({ boardId: z.string() }), ({ args: { boardId } }) =>
    zql.stages
      .where('boardId', boardId)
      .orderBy('sequenceNumber', 'asc')
      .related('approvers')
      .related('formContextMappings')
  ),

  stagesByBoards: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) =>
    zql.stages
      .whereExists('board', (b) => b.where('projectId', projectId))
      .orderBy('boardId', 'asc')
      .orderBy('sequenceNumber', 'asc')
  ),

  channelCanvases: defineQuery(
    z.object({ channelId: z.string(), includeQuartoDocs: z.boolean().optional() }),
    ({ ctx, args: { channelId, includeQuartoDocs } }) => {
      let query = zql.canvases.where('channelId', channelId).where((helpers) => {
        return helpers.or(
          helpers.cmp('createdBy', ctx.userID),
          helpers.cmp('visibility', CanvasVisibility.PUBLIC),
          helpers.exists('participants', (p) => p.where('userId', ctx.userID))
        );
      });

      if (!includeQuartoDocs) {
        query = query.where((helpers) =>
          helpers.or(helpers.cmp('docType', DocType.Canvas), helpers.cmp('docType', 'IS', null))
        );
      }

      return query.orderBy('updatedAt', 'desc').related('participants').related('channel');
    }
  ),

  // Query for Quarto docs in a channel
  // All channel-scoped Quarto docs are visible to all channel members
  channelQuartoDocs: defineQuery(z.object({ channelId: z.string() }), ({ args: { channelId } }) => {
    return zql.canvases
      .where('channelId', channelId)
      .where('docType', DocType.Quarto)
      .orderBy('updatedAt', 'desc')
      .related('participants')
      .related('channel');
  }),

  canvasParticipants: defineQuery(z.object({ canvasId: z.string() }), ({ args: { canvasId } }) => {
    return zql.canvas_participants.where('canvasId', canvasId).related('canvas');
  }),

  getCanvas: defineQuery(z.object({ canvasId: z.string() }), ({ ctx, args: { canvasId } }) => {
    return zql.canvases
      .where((helpers) => {
        return helpers.or(
          helpers.cmp('id', canvasId),
          helpers.cmp('viewAccessId', canvasId),
          helpers.cmp('editAccessId', canvasId),
          helpers.cmp('userRepo', canvasId) // Also allow lookup by userRepo
        );
      })
      .where((helpers) => {
        return helpers.or(
          helpers.cmp('createdBy', ctx.userID),
          helpers.cmp('visibility', CanvasVisibility.PUBLIC),
          helpers.exists('participants', (p) => p.where('userId', ctx.userID)),
          helpers.cmp('viewAccessId', canvasId),
          helpers.cmp('editAccessId', canvasId)
        );
      })
      .related('participants')
      .related('channel')
      .one();
  }),

  ticketActivities: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) =>
    zql.ticket_activities.where('ticketId', ticketId).orderBy('timestamp', 'desc')
  ),

  channelAndThreadMessages: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
      return zql.messages
        .where('showInChannel', true)
        .whereExists('conversation', (c) => c.where('channelId', channelId))
        .orderBy('createdAt', 'asc')
        .related('conversation', (c) =>
          c.related('initialMessage', (im) =>
            im.where(({ or, cmp }) =>
              or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
            )
          )
        )
        .related('attachments')
        .related('reactionCounts')
        .related('reactions');
    }
  ),

  getAllProjects: defineQuery(() => {
    return zql.projects.orderBy('createdAt', 'desc').related('boards');
  }),

  getAllBoards: defineQuery(() => {
    return zql.boards
      .orderBy('createdAt', 'desc')
      .related('project')
      .related('stages', stagesQuery =>
        stagesQuery
          .orderBy('sequenceNumber', 'asc')
          .related('approvers')
          .related('formContextMappings'),
      );
  }),

  searchChannelParticipants: defineQuery(
    z.object({ channelId: z.string(), searchQuery: z.string() }),
    ({ args: { channelId, searchQuery } }) => {
      return zql.channel_participants
        .where('channelId', channelId)
        .whereExists('user', (u) => u.where('name', 'ILIKE', `%${searchQuery}%`));
    }
  ),

  channelParticipantsPaginated: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number(),
      start: z.object({ role: z.nativeEnum(ChannelRole), userId: z.string() }).nullable(),
    }),
    ({ args: { channelId, limit, start } }) => {
      let query = zql.channel_participants.where('channelId', channelId);

      query = query.orderBy('role', 'asc').orderBy('userId', 'asc');

      // Apply cursor pagination if start is provided
      if (start) {
        query = query.start({ role: start.role, userId: start.userId }, { inclusive: false });
      }

      return query.limit(limit);
    }
  ),

  getAllUserGroups: defineQuery(() => {
    return zql.user_groups.orderBy('createdAt', 'desc');
  }),

  getUserGroupMembers: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.user_group_mappings.where('userGroupId', userGroupId).orderBy('createdAt', 'desc');
    }
  ),

  userBookmarks: defineQuery(() => {
    return zql.bookmarks.orderBy('createdAt', 'desc');
  }),

  attachmentsByInitialMessage: defineQuery(
    z.object({ initialMessageId: z.string() }),
    ({ args: { initialMessageId } }) => {
      return zql.message_attachments
        .where('entityId', initialMessageId)
        .where('entityType', AttachmentEntityType.CHAT)
        .orderBy('createdAt', 'desc');
    }
  ),

  attachmentsByTicket: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.message_attachments
      .where('entityId', ticketId)
      .where('entityType', AttachmentEntityType.TICKET)
      .orderBy('createdAt', 'desc');
  }),

  channelConversationsPaginated: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number(),
      start: z.object({ conversationId: z.string(), createdAt: z.number() }).nullable(),
      direction: z.literal('forward').or(z.literal('backward')),
    }),
    ({ ctx, args: { channelId, limit, start, direction } }) => {
      let query = zql.conversations
        .where('channelId', channelId)
        .related('initialMessage', (initialMessageQuery) =>
          initialMessageQuery
            .where(({ or, cmp }) =>
              or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
            )
            .related('reactions')
            .related('reactionCounts')
            .related('attachments')
        )
        .related('parentMessage')
        .related('participants', (participantQuery) =>
          participantQuery
            .where('participationType', ConversationParticipation.AUTHOR)
            .orderBy('joinedAt', 'asc')
        )
        .related('ticket');

      // Apply ordering based on direction
      const orderDirection = direction === 'forward' ? 'desc' : 'asc';
      query = query.orderBy('createdAt', orderDirection);

      // Apply cursor pagination if start is provided
      if (start) {
        query = query.start(
          { conversationId: start.conversationId, createdAt: start.createdAt },
          { inclusive: direction === 'forward' }
        );
      }

      // Apply limit
      return limit ? query.limit(limit) : query;
    }
  ),
  channelConversationsPaginatedV2: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number(),
      start: z.object({ createdAt: z.number() }).nullable(),
      direction: z.literal('forward').or(z.literal('backward')),
    }),
    ({ ctx, args: { channelId, limit, start, direction } }) => {
      let query = zql.conversations
        .where('channelId', channelId)
        .related('initialMessage', initialMessageQuery =>
          initialMessageQuery
            .where(helpers => {
              return helpers.or(
                helpers.cmp('visibleTo', 'IS', null),
                helpers.cmp('visibleTo', '=', ctx.userID),
              );
            })
            .related('reactions')
            .related('reactionCounts')
            .related('attachments'),
        )
        .related('parentMessage')
        .related('participants', participantQuery =>
          participantQuery
            .where('participationType', ConversationParticipation.AUTHOR)
            .orderBy('joinedAt', 'asc'),
        )
        .related('ticket');

      // Apply ordering based on direction
      const orderDirection = direction === 'forward' ? 'desc' : 'asc';
      query = query.orderBy('createdAt', orderDirection);

      // Apply cursor pagination if start is provided
      if (start) {
        query = query.start({ createdAt: start.createdAt }, { inclusive: direction === 'forward' });
      }

      // Apply limit
      return limit ? query.limit(limit) : query;
    },
  ),
  channelLatestMultipleConversations: defineQuery(
    z.object({ channelId: z.string(), limit: z.number() }),
    ({ ctx, args: { channelId, limit } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .related('initialMessage', initialMessageQuery =>
          initialMessageQuery
            .where(helpers => {
              return helpers.or(
                helpers.cmp('visibleTo', 'IS', null),
                helpers.cmp('visibleTo', '=', ctx.userID),
              );
            })
            .related('reactions')
            .related('reactionCounts')
            .related('attachments'),
        )
        .related('parentMessage')
        .related('participants', participantQuery =>
          participantQuery
            .where('participationType', ConversationParticipation.AUTHOR)
            .orderBy('joinedAt', 'asc'),
        )
        .related('ticket')
        .orderBy('createdAt', 'desc')
        .limit(limit);
    },
  ),

  channelLatestConversation: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .orderBy('createdAt', 'desc')
        .orderBy('conversationId', 'desc')
        .limit(1)
        .one();
    }
  ),

  getConversationAttachements: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number(),
      start: z.object({ attachementId: z.string(), createdAt: z.number() }).nullable(),
      direction: z.literal('forward').or(z.literal('backward')),
    }),
    ({ ctx, args: { channelId, limit, start, direction } }) => {
      let query = zql.message_attachments;
      query = query.where(({ exists }) =>
        exists('conversation', (conv) =>
          conv.where('channelId', channelId).where(({ or, exists }) =>
            or(
              exists('channel', (c) => c.where('visibility', '=', ChannelVisibility.PUBLIC), {
                flip: true,
              }),
              exists(
                'channel',
                (c) =>
                  c.whereExists(
                    'participants',
                    (v) => v.where('userId', ctx.userID).where('channelId', channelId),
                    { flip: true }
                  ),
                { flip: true }
              )
            )
          )
        )
      );

      if (start) {
        query = query.start(
          { id: start.attachementId, createdAt: start.createdAt },
          { inclusive: true }
        );
      }

      query = query.orderBy('createdAt', direction === 'forward' ? 'desc' : 'asc');

      if (limit) {
        query = query.limit(limit);
      }

      return query;
    }
  ),

  getPinnedMesseges: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .where('pinned', true)
        .related('initialMessage', (initialMessageQuery) =>
          initialMessageQuery
            .where(({ or, cmp }) =>
              or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
            )
            .related('reactions')
            .related('reactionCounts')
            .related('attachments')
        )
        .related('parentMessage')
        .related('ticket')
        .related('participants', (participantQuery) =>
          participantQuery
            .where('participationType', ConversationParticipation.AUTHOR)
            .orderBy('joinedAt', 'asc')
        );
    }
  ),

  channelLatestMessage: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .related('initialMessage', (initialMessageQuery) =>
          initialMessageQuery
            .where((helpers) => {
              return helpers.or(
                helpers.cmp('visibleTo', 'IS', null),
                helpers.cmp('visibleTo', '=', ctx.userID)
              );
            })
            .related('reactions')
            .related('reactionCounts')
            .related('attachments')
        )
        .orderBy('createdAt', 'desc')
        .one();
    }
  ),

  conversationOfUserChannels: defineQuery(({ ctx }) => {
    return zql.channels
      .where((helpers) => {
        return helpers.exists('participantsStatus', (p) => {
          return p.where('isClosed', false).where('userId', ctx.userID);
        });
      })
      .related('conversations', (c) => c.orderBy('createdAt', 'desc').limit(10));
  }),

  getUserGroupById: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.user_groups.where('id', userGroupId).one();
    }
  ),

  getBoardById: defineQuery(z.object({ boardId: z.string() }), ({ args: { boardId } }) => {
    return zql.boards.where('id', boardId).related('project').one();
  }),

  getAllTicketEntityMappings: defineQuery(() => {
    return zql.ticket_entity_mappings;
  }),

  getAllTicketTags: defineQuery(() => {
    return zql.ticket_tags;
  }),

  getTicketEntityMappingsByTicketId: defineQuery(
    z.object({ ticketId: z.string() }),
    ({ args: { ticketId } }) => {
      return zql.ticket_entity_mappings.where('ticketId', ticketId);
    }
  ),

  getStagesByBoardIds: defineQuery(
    z.object({ boardIds: z.array(z.string()) }),
    ({ args: { boardIds } }) => {
      if (boardIds.length === 0) {
        return zql.stages.where('id', 'nonexistent').limit(0);
      }
      return zql.stages
        .where('boardId', 'IN', boardIds)
        .orderBy('sequenceNumber', 'asc')
    }
  ),

  getBoardComplexityScores: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.board_complexity_scores.where('userGroupId', userGroupId).related('board');
    }
  ),

  getUserExpertiseMappings: defineQuery(
    z.object({ userGroupId: z.string(), boardId: z.string() }),
    ({ args: { userGroupId, boardId } }) => {
      return zql.user_expertise_mappings
        .where('userGroupId', userGroupId)
        .where('boardId', boardId);
    }
  ),

  getUserAssignmentStates: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.user_assignment_states.where('userGroupId', userGroupId);
    }
  ),
  // Query for all assignment states for a user across all groups
  getUserAssignmentStatesByUserId: defineQuery(
    z.object({ userId: z.string() }),
    ({ args: { userId } }) => {
      return zql.user_assignment_states.where('userId', userId);
    }
  ),

  // Repository queries
  getAllRepos: defineQuery(() => {
    return zql.repos.orderBy('name', 'asc');
  }),
  getAllForms: defineQuery(() => {
    return zql.forms
      .related('formFields')
      .related('formContextMappings')
      .orderBy('createdAt', 'desc')
  }),
  // Query for form fields by form ID
  getFormFieldsByFormId: defineQuery(z.object({ formId: z.string() }), ({ args: { formId } }) => {
    return zql.form_fields.where('formId', formId).orderBy('createdAt', 'asc');
  }),

  // Generic query to fetch all form fields (name and value) for a given entity
  getFormEntityValuesByEntityId: defineQuery(
    z.object({
      entityId: z.string(),
    }),
    ({ args: { entityId } }) => {
      return zql.form_entity_values
        .where('entityId', entityId)
        .related('formField')
        .orderBy('createdAt', 'asc');
    }
  ),
  // Query to get forms by context type (e.g., BOARD)
  getFormsByContextType: defineQuery(
    z.object({ contextType: z.nativeEnum(FormContextType) }),
    ({ args: { contextType } }) => {
      return zql.forms
        .where('contextType', contextType)
        .related('formFields')
        .related('formContextMappings')
        .orderBy('createdAt', 'desc');
    }
  ),
  // Query to get form context mapping for a specific context
  getFormMappingByContextId: defineQuery(
    z.object({
      contextId: z.string(),
      contextType: z.nativeEnum(FormContextType),
      entityType: z.nativeEnum(FormEntityType),
    }),
    ({ args: { contextId, contextType, entityType } }) => {
      return zql.forms_context_mapping
        .where('contextId', contextId)
        .where('contextType', contextType)
        .where('entityType', entityType)
        .related('formFields')
        .one();
    }
  ),
  // Query to get all form entity values for tickets (cached for reuse across all boards)
  getAllFormEntityValues: defineQuery(() => {
    return zql.form_entity_values.where('entityType', FormEntityType.TICKET).related('formField');
  }),

  // Dashboard queries
  getAllDashboards: defineQuery(() => {
    return zql.dashboards.orderBy('updatedAt', 'desc');
  }),
  getDashboardById: defineQuery(
    z.object({ dashboardId: z.string() }),
    ({ args: { dashboardId } }) => {
      return zql.dashboards
        .where('id', dashboardId)
        .related('queryMappings', (mapping) => mapping.related('query'))
        .one();
    }
  ),
  getAllCustomEmojis: defineQuery(() => {
    return zql.custom_emojis.orderBy('createdAt', 'desc').related('creator');
  }),

  getCustomEmojiById: defineQuery(z.object({ emojiId: z.string() }), ({ args: { emojiId } }) => {
    return zql.custom_emojis.where('id', emojiId).related('creator').one();
  }),

  getCustomEmojiByName: defineQuery(z.object({ name: z.string() }), ({ args: { name } }) => {
    return zql.custom_emojis.where('name', name).related('creator').one();
  }),

  lookupValuesByType: defineQuery(
    z.object({ type: z.nativeEnum(LookupType) }),
    ({ args: { type } }) => {
      return zql.lookup_values.where('type', type).orderBy('createdAt', 'asc');
    },
  ),
});
 