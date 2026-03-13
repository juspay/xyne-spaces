import { createBuilder, defineQueries } from '@rocicorp/zero';
import {
  BaseTicketType,
  CallType,
  defineQuery,
  FormContextType,
  FormEntityType,
  LookupType,
} from '@xyne/shared';
import { z } from 'zod';
import {
  ActivityClassification,
  AttachmentEntityType,
  CallStatus,
  CanvasVisibility,
  ChannelRole,
  ChannelVisibility,
  ChannelType,
  ConversationParticipation,
  DocType,
  schema,
  LinkVisibility,
  NudgeState,
} from '@xyne/shared';

export const zql = createBuilder(schema);

window.__builder = zql;

export const queries = defineQueries({
  channelConversations: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .orderBy('createdAt', 'asc')
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
    },
  ),
  conversationMessages: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ ctx, args: { conversationId } }) => {
      return zql.messages
        .where('conversationId', conversationId)
        .where(helpers => {
          return helpers.or(
            // Message is visible to everyone (visibleTo is null)
            helpers.cmp('visibleTo', 'IS', null),
            // Message is visible to current user
            helpers.cmp('visibleTo', '=', ctx.userID),
          );
        })
        .orderBy('createdAt', 'asc')
        .related('attachments')
        .related('reactionCounts')
        .related('reactions');
    },
  ),

  messageNudges: defineQuery(
    z.object({
      messageId: z.string(),
      states: z.array(z.string()).optional(),
    }),
    ({ ctx, args: { messageId, states } }) => {
      const effectiveStates =
        states && states.length > 0 ? states.map(s => s as NudgeState) : [NudgeState.ACTIVE];
      let query = zql.surface_nudges.where('sourceId', messageId);
      if (effectiveStates.length === 1) {
        const singleState = effectiveStates[0];
        if (singleState) {
          query = query.where('state', singleState);
        }
      } else if (effectiveStates.length > 1) {
        query = query.where(helpers =>
          helpers.or(...effectiveStates.map(value => helpers.cmp('state', '=', value))),
        );
      }

      // Filter by nudge-level visibleTo
      query = query.where(helpers =>
        helpers.or(helpers.cmp('visibleTo', 'IS', null), helpers.cmp('visibleTo', '=', ctx.userID)),
      );

      return query
        .whereExists('sourceMessage', m =>
          m
            .where(helpers =>
              helpers.or(
                helpers.cmp('visibleTo', 'IS', null),
                helpers.cmp('visibleTo', '=', ctx.userID),
              ),
            )
            .whereExists('conversation', c =>
              c.whereExists('channel', ch =>
                ch.where(helpers =>
                  helpers.or(
                    helpers.cmp('visibility', ChannelVisibility.PUBLIC),
                    helpers.and(
                      helpers.cmp('visibility', ChannelVisibility.PRIVATE),
                      helpers.exists('participants', p => p.where('userId', ctx.userID)),
                    ),
                  ),
                ),
              ),
            ),
        )
        .orderBy('createdAt', 'asc');
    },
  ),
  getConversationById: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ ctx, args: { conversationId } }) => {
      return zql.conversations
        .where('conversationId', conversationId)
        .related('initialMessage', im =>
          im.where(helpers => {
            return helpers.or(
              helpers.cmp('visibleTo', 'IS', null),
              helpers.cmp('visibleTo', '=', ctx.userID),
            );
          }),
        )
        .related('parentMessage')
        .related('participants')
        .related('ticket')
        .one();
    },
  ),
  getConversationByCallId: defineQuery(
    z.object({ callId: z.string() }),
    ({ ctx, args: { callId } }) => {
      return zql.conversations
        .where('callId', callId)
        .related('initialMessage', im =>
          im.where(helpers => {
            return helpers.or(
              helpers.cmp('visibleTo', 'IS', null),
              helpers.cmp('visibleTo', '=', ctx.userID),
            );
          }),
        )
        .one();
    },
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
    },
  ),
  allTickets: defineQuery(() => {
    return zql.tickets
      .orderBy('createdAt', 'desc')
      .related('project')
      .related('assignments')
      .related('stageEtaEntries');
  }),
  // ============================================================================
  // CENTRALIZED TICKET QUERY SYSTEM
  // ============================================================================
  // These queries do NOT fetch formEntityValues by default.
  // Use formEntityValuesByFieldId for grouping by form fields.
  // Dynamic field filters are applied server-side via whereExists.

  // View mode type for centralized query
  // NOTE: Dynamic field filtering is done CLIENT-SIDE via applyTicketFilters.
  // When formEntityValueFieldIds is provided, formEntityValues are fetched as a related query
  // filtered by those fieldIds, and filtering is applied client-side.
  ticketsQuery: defineQuery(
    z.object({
      viewMode: z.enum(['project', 'board', 'my-tickets', 'user-tickets', 'group-tickets']),
      projectId: z.string().optional(),
      boardId: z.string().optional(),
      userId: z.string().optional(),
      groupId: z.string().optional(),
      formEntityValueFieldIds: z.array(z.string()).optional(),
    }),
    ({ ctx, args: { viewMode, projectId, boardId, userId, groupId, formEntityValueFieldIds } }) => {
      let query = zql.tickets;

      // Apply explicit board filter if provided (works across all view modes)
      // boardId implicitly scopes to project, so no need for separate projectId filter
      if (boardId && viewMode !== 'my-tickets') {
        query = query.where('boardId', boardId);
      }
      // Apply projectId filter ONLY if:
      // 1. No boardId exists (boardId is more specific and implies project)
      // 2. viewMode is not 'my-tickets' (should be cross-project)
      // This allows combining project scoping with user/group filtering
      if (!boardId && viewMode !== 'my-tickets' && projectId) {
        query = query.where('projectId', projectId);
      }

      // Apply context filter based on viewMode
      switch (viewMode) {
        case 'my-tickets':
          query = query.where(helpers =>
            helpers.or(
              helpers.cmp('assignedTo', `user:${ctx.userID}`),
              helpers.cmp('assignedTo', ctx.userID),
              helpers.cmp('createdBy', `user:${ctx.userID}`),
              helpers.cmp('createdBy', ctx.userID),
            ),
          );
          break;
        case 'user-tickets':
          if (userId) {
            query = query.where(helpers =>
              helpers.or(
                helpers.cmp('assignedTo', `user:${userId}`),
                helpers.cmp('assignedTo', userId),
                helpers.cmp('createdBy', `user:${userId}`),
                helpers.cmp('createdBy', userId),
              ),
            );
          }
          break;
        case 'group-tickets':
          if (groupId) {
            query = query.where(helpers =>
              helpers.or(
                helpers.cmp('userGroupId', `group:${groupId}`),
                helpers.cmp('userGroupId', groupId),
              ),
            );
          }
          break;
      }

      // Build the base query with related data
      let finalQuery = query
        .orderBy('createdAt', 'desc')
        .related('assignments')
        .related('stageEtaEntries');

      // Conditionally add formEntityValues related query when fieldIds are provided
      // All dynamic field filtering is done client-side via applyTicketFilters
      if (formEntityValueFieldIds && formEntityValueFieldIds.length > 0) {
        finalQuery = finalQuery.related('formEntityValues', fev =>
          fev.where('fieldId', 'IN', formEntityValueFieldIds).related('formField'),
        );
      }

      return finalQuery;
    },
  ),

  workflowsPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), createdAt: z.number() }).nullable(),
      searchQuery: z.string().optional(),
      statusFilter: z.array(z.string()).optional(),
      workflowTypeFilter: z.array(z.string()).optional(),
      createdByFilter: z.array(z.string()).optional(),
      assignedToFilter: z.array(z.string()).optional(),
      dateRangeFilter: z.object({ startDate: z.number(), endDate: z.number() }).optional(),
    }),
    ({
      args: {
        limit,
        start,
        searchQuery,
        statusFilter,
        workflowTypeFilter,
        createdByFilter,
        assignedToFilter,
        dateRangeFilter,
      },
    }) => {
      let query = zql.workflows;

      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim();
        query = query.where(helpers =>
          helpers.or(
            helpers.exists('ticket', ticket => ticket.where('title', 'ILIKE', `%${q}%`)),
            helpers.exists('ticket', ticket => ticket.where('xyneId', 'ILIKE', `%${q}%`)),
            helpers.cmp('workflowName', 'ILIKE', `%${q}%`),
          ),
        );
      }

      if (statusFilter && statusFilter.length > 0) {
        query = query.where('status', 'IN', statusFilter);
      }

      if (workflowTypeFilter && workflowTypeFilter.length > 0) {
        query = query.where('workflowType', 'IN', workflowTypeFilter);
      }

      if (createdByFilter && createdByFilter.length > 0) {
        query = query.whereExists('ticket', ticket =>
          ticket.where('createdBy', 'IN', createdByFilter),
        );
      }

      if (assignedToFilter && assignedToFilter.length > 0) {
        query = query.whereExists('ticket', ticket =>
          ticket.where('assignedTo', 'IN', assignedToFilter),
        );
      }

      if (dateRangeFilter) {
        query = query
          .where('createdAt', '>=', dateRangeFilter.startDate)
          .where('createdAt', '<=', dateRangeFilter.endDate);
      }

      query = query.orderBy('createdAt', 'desc');

      if (start) {
        query = query.start({ id: start.id, createdAt: start.createdAt }, { inclusive: false });
      }

      return query.limit(limit).related('ticket');
    },
  ),
  ticketsForEmailChannels: defineQuery(() => {
    return zql.tickets
      .whereExists('conversation', conversation =>
        conversation.whereExists('channel', channel => channel.where('type', ChannelType.EMAIL)),
      )
      .orderBy('createdAt', 'desc')
      .related('project')
      .related('tags')
      .related('entity')
      .related('conversation');
  }),
  // Unified query for Xyne Desk: filters by EMAIL channels with optional channel and merchant filters
  supportTicketsFiltered: defineQuery(
    z
      .object({
        channelId: z.string().optional(),
        merchantMid: z.string().optional(),
      })
      .optional(),
    ({ args }) => {
      let query = zql.tickets;

      // If specific channelId provided (from email channels dropdown), use direct filter
      // Otherwise, filter by EMAIL channel type to get all email support tickets
      if (args?.channelId) {
        query = query.where('channelId', args.channelId);
      } else {
        query = query.whereExists('channel', channel => channel.where('type', ChannelType.EMAIL));
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
        .related('conversation', c => c.related('channel'));
    },
  ),
  // Get all merchants for Xyne Desk dropdown (simple indexed query on small Merchant table)
  getAllMerchants: defineQuery(() => {
    return zql.merchants.orderBy('mid', 'asc');
  }),
  getEmailsForTicket: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ args: { conversationId } }) => {
      return zql.emails.where('conversationId', conversationId);
    },
  ),
  getDraftForConversation: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ args: { conversationId } }) => {
      return zql.email_drafts.where('conversationId', conversationId);
    },
  ),
  ticketById: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.tickets
      .where('id', ticketId)
      .related('project')
      .related('tags')
      .related('assignments')
      .related('referencesOut', ref => ref.related('targetTicket'))
      .related('referencesIn', ref => ref.related('sourceTicket'))
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
      .related('referencesOut', ref => ref.related('targetTicket'))
      .related('referencesIn', ref => ref.related('sourceTicket'))
      .related('entity')
      .related('conversation')
      .one();
  }),
  ticketsByIds: defineQuery(
    z.object({ ticketIds: z.array(z.string()) }),
    ({ args: { ticketIds } }) => {
      return zql.tickets.where(helpers => helpers.cmp('id', 'IN', ticketIds));
    },
  ),
  getWorkflowForTicket: defineQuery(
    z.object({ ticketId: z.string() }), // ticketId parameter
    ({ args: { ticketId } }) => {
      return zql.workflows
        .where('ticketId', ticketId)
        .related('workflowExecutions', executionQuery => executionQuery.orderBy('createdAt', 'asc'))
        .orderBy('createdAt', 'asc');
    },
  ),
  subTicketsForTicket: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.ticket_sub_ticket_mappings
      .where('ticketId', ticketId)
      .related('subTicket', subTicketQuery =>
        subTicketQuery.related('conversation').related('mappedTicket'),
      )
      .orderBy('id', 'asc');
  }),
  subTicketsByMappedTicketId: defineQuery(
    z.object({ mappedTicketId: z.string() }),
    ({ args: { mappedTicketId } }) => {
      return zql.sub_tickets.where('mappedTicketId', mappedTicketId).related('ticketMappings');
    },
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
    return zql.channels.whereExists('participantsStatus', p =>
      p.where('isClosed', false).where('userId', ctx.userID),
    );
  }),
  channelParticipants: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.channel_participants.where('channelId', channelId);
    },
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
        .whereExists('participants', participantsQuery => participantsQuery.where('userId', userId))
        .orderBy('lastActivityAt', 'desc');

      if (start) {
        query = query.start(
          { lastActivityAt: start.lastActivityAt, conversationId: start.id },
          { inclusive: false },
        );
      }
      return query.limit(limit);
    },
  ),
  searchChannelParticipants: defineQuery(
    z.object({ channelId: z.string(), searchQuery: z.string() }),
    ({ args: { channelId, searchQuery } }) => {
      return zql.channel_participants
        .where('channelId', channelId)
        .whereExists('user', u => u.where('name', 'ILIKE', `%${searchQuery}%`));
    },
  ),
  channelParticipantsPaginated: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number(),
      start: z.object({ role: z.enum(ChannelRole), userId: z.string() }).nullable(),
    }),
    ({ args: { channelId, limit, start } }) => {
      let query = zql.channel_participants.where('channelId', channelId);

      query = query.orderBy('role', 'asc').orderBy('userId', 'asc');

      // Apply cursor pagination if start is provided
      if (start) {
        query = query.start({ role: start.role, userId: start.userId }, { inclusive: false });
      }

      return query.limit(limit);
    },
  ),
  getUserMultipleChannelParticipations: defineQuery(
    z.object({ channelIds: z.array(z.string()) }),
    ({ ctx, args: { channelIds } }) => {
      if (channelIds.length === 0) {
        // Return empty query if no channel IDs provided
        return zql.channel_user_status.where('channelId', 'nonexistent').limit(0);
      }

      return zql.channel_user_status.where('userId', ctx.userID).where(helpers => {
        return helpers.cmp('channelId', 'IN', channelIds);
      });
    },
  ),
  getAllChannelsUserStatus: defineQuery(({ ctx }) => {
    return zql.channel_user_status.where('userId', ctx.userID);
  }),
  getUsers: defineQuery(() => {
    return zql.users.related('presenceStatus');
  }),
  getUserProfilesByIds: defineQuery(
    z.object({ userIds: z.array(z.string()) }),
    ({ args: { userIds } }) => {
      return zql.user_profiles.where('userId', 'IN', userIds);
    },
  ),
  getUserProfile: defineQuery(z.object({ userId: z.string() }), ({ args: { userId } }) => {
    return zql.user_profiles.where('userId', userId).one();
  }),
  userActiveCalls: defineQuery(() => {
    return zql.calls
      .where('status', CallStatus.ACTIVE)
      .orderBy('startedAt', 'desc')
      .related('participants');
  }),
  activeCallsInChannel: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.calls
        .where('channelId', channelId)
        .where('status', CallStatus.ACTIVE)
        .orderBy('startedAt', 'desc')
        .related('participants');
    },
  ),
  userScheduledCalls: defineQuery(() => {
    return zql.calls
      .where('status', CallStatus.SCHEDULED)
      .orderBy('startsAt', 'asc')
      .related('participants');
  }),
  userCallHistory: defineQuery(() => {
    return zql.calls
      .where(helpers => helpers.cmp('callType', 'NOT IN', [CallType.HEADLESS]))
      .where(helpers =>
        helpers.cmp('status', 'NOT IN', [CallStatus.SCHEDULED, CallStatus.CANCELLED]),
      )
      .orderBy('startedAt', 'desc')
      .limit(100)
      .related('participants');
  }),

  userActivities: defineQuery(() => {
    return zql.activities
      .orderBy('createdAt', 'desc')
      .related('message', m =>
        m
          .related('conversation')
          .related('reactions')
          .related('reactionCounts')
          .related('attachments'),
      )
      .related('reaction')
      .related('canvas')
      .related('ticket');
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
        query = query.where(helpers =>
          helpers.or(...types.map(type => helpers.cmp('actorAction', '=', type))),
        );
      }

      if (classification && classification.length > 0) {
        query = query.where(helpers =>
          helpers.or(...classification.map(c => helpers.cmp('classification', '=', c))),
        );
      }

      query = query.orderBy('createdAt', 'desc').orderBy('id', 'desc');

      if (start) {
        query = query.start({ id: start.id, createdAt: start.createdAt }, { inclusive: false });
      }

      return query
        .limit(limit)
        .related('message', m =>
          m
            .related('conversation')
            .related('reactions')
            .related('reactionCounts')
            .related('attachments'),
        )
        .related('reaction')
        .related('canvas')
        .related('ticket');
    },
  ),
  userMissedCalls: defineQuery(({ ctx }) => {
    return zql.activities
      .where('userId', ctx.userID)
      .where('actorAction', 'missed_call')
      .where('isRead', false);
  }),
  // Query for user's unread activities with channel relationship
  userUnreadActivities: defineQuery(() => {
    return zql.activities.where('isRead', false).orderBy('createdAt', 'desc').related('channel');
  }),
  userDrafts: defineQuery(({ ctx }) => {
    return zql.draft_messages.where('userId', ctx.userID).related('attachments');
  }),
  // Query for message with sender and channel info for activity display
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
    },
  ),

  // Get unread thread activities excluding @channel or @here mentions
  userUnreadThreadActivities: defineQuery(() => {
    return zql.activities
      .where('isRead', false)
      .where('actionSource', 'message')
      .whereExists('message', m =>
        m.whereExists('conversation', c => c.where('replyCount', '>', 0)),
      );
  }),

  channelCanvases: defineQuery(
    z.object({ channelId: z.string(), includeQuartoDocs: z.boolean().optional() }),
    ({ ctx, args: { channelId, includeQuartoDocs } }) => {
      let query = zql.canvases.where('channelId', channelId).where(helpers => {
        return helpers.or(
          helpers.cmp('createdBy', ctx.userID),
          helpers.cmp('visibility', CanvasVisibility.PUBLIC),
          helpers.exists('participants', p => p.where('userId', ctx.userID)),
        );
      });

      // By default, exclude Quarto docs from regular canvas list
      // Also include docs with null docType (legacy data) as Canvas
      if (!includeQuartoDocs) {
        query = query.where(helpers =>
          helpers.or(helpers.cmp('docType', DocType.Canvas), helpers.cmp('docType', 'IS', null)),
        );
      }

      return query.orderBy('updatedAt', 'desc').related('participants').related('channel');
    },
  ),
  // Query for Quarto docs in a channel
  channelQuartoDocs: defineQuery(z.object({ channelId: z.string() }), ({ args: { channelId } }) => {
    return zql.canvases
      .where('channelId', channelId)
      .where('docType', DocType.Quarto)
      .orderBy('updatedAt', 'desc')
      .related('participants')
      .related('channel');
  }),

  // Query for links in a channel (shared + personal + shared with user)
  channelLinks: defineQuery(z.object({ channelId: z.string() }), ({ ctx, args: { channelId } }) => {
    return zql.links
      .where('channelId', channelId)
      .where(helpers => {
        return helpers.or(
          // All DEFAULT visibility links
          helpers.cmp('visibility', LinkVisibility.DEFAULT),
          // PERSONAL links created by current user
          helpers.and(
            helpers.cmp('visibility', LinkVisibility.PERSONAL),
            helpers.cmp('createdBy', ctx.userID),
          ),
          // PERSONAL links shared with current user
          helpers.and(
            helpers.cmp('visibility', LinkVisibility.PERSONAL),
            helpers.exists('sharedWith', sw => sw.where('userId', ctx.userID)),
          ),
        );
      })
      .related('sharedWith')
      .orderBy('createdAt', 'desc');
  }),
  canvasParticipants: defineQuery(z.object({ canvasId: z.string() }), ({ args: { canvasId } }) => {
    return zql.canvas_participants.where('canvasId', canvasId).related('canvas');
  }),
  channelAndThreadMessages: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
      return zql.messages
        .where('showInChannel', true)
        .whereExists('conversation', c => c.where('channelId', channelId))
        .orderBy('createdAt', 'asc')
        .related('conversation', c =>
          c.related('initialMessage', im =>
            im.where(helpers => {
              return helpers.or(
                helpers.cmp('visibleTo', 'IS', null),
                helpers.cmp('visibleTo', '=', ctx.userID),
              );
            }),
          ),
        )
        .related('attachments')
        .related('reactionCounts')
        .related('reactions');
    },
  ),
  getAllProjects: defineQuery(() => {
    return zql.projects.orderBy('createdAt', 'desc').related('boards');
  }),
  // Lightweight board list queries — just names/IDs for dropdown pickers.
  // No related data (stages, formContextMappings) to avoid heavy fetches.

  // Fetch a specific set of boards by their IDs — used in my-tickets view
  // to avoid fetching all boards globally when we already know which boards exist
  // from the user's tickets. The caller is responsible for only enabling this
  // query when boardIds is non-empty.
  boardsByIds: defineQuery(
    z.object({ boardIds: z.array(z.string()) }),
    ({ args: { boardIds } }) => {
      return zql.boards
        .where(helpers => helpers.cmp('id', 'IN', boardIds))
        .orderBy('createdAt', 'desc');
    },
  ),

  boardsListByProject: defineQuery(
    z.object({ projectId: z.string() }),
    ({ args: { projectId } }) => {
      return zql.boards.where('projectId', projectId).orderBy('createdAt', 'asc');
    },
  ),

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
  projectById: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) => {
    return zql.projects.where('id', projectId).one();
  }),
  ticketsByProject: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) => {
    return zql.tickets.where('projectId', projectId).related('tags').orderBy('createdAt', 'desc');
  }),
  boardsByProject: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) => {
    return zql.boards
      .where('projectId', projectId)
      .orderBy('createdAt', 'asc')
      .related('stages', stagesQuery =>
        stagesQuery
          .orderBy('sequenceNumber', 'asc')
          .related('prStatusMappings')
          .related('formContextMappings')
          .related('approvers'),
      )
      .related('formContextMappings', mappingQuery => mappingQuery.related('formFields'));
  }),
  stagesByBoard: defineQuery(z.object({ boardId: z.string() }), ({ args: { boardId } }) => {
    return zql.stages
      .where('boardId', boardId)
      .orderBy('sequenceNumber', 'asc')
      .related('approvers')
      .related('formContextMappings');
  }),
  stagesByBoards: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) => {
    return zql.stages
      .whereExists('board', b => b.where('projectId', projectId))
      .orderBy('boardId', 'asc')
      .orderBy('sequenceNumber', 'asc');
  }),
  ticketActivities: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.ticket_activities.where('ticketId', ticketId).orderBy('timestamp', 'desc');
  }),
  getCanvas: defineQuery(z.object({ canvasId: z.string() }), ({ ctx, args: { canvasId } }) => {
    return zql.canvases
      .where(helpers => {
        return helpers.or(
          helpers.cmp('id', canvasId),
          helpers.cmp('viewAccessId', canvasId),
          helpers.cmp('editAccessId', canvasId),
          helpers.cmp('userRepo', canvasId), // Also allow lookup by userRepo
        );
      })
      .where(helpers => {
        return helpers.or(
          helpers.cmp('createdBy', ctx.userID),
          helpers.cmp('visibility', CanvasVisibility.PUBLIC),
          helpers.exists('participants', p => p.where('userId', ctx.userID)),
          helpers.cmp('viewAccessId', canvasId),
          helpers.cmp('editAccessId', canvasId),
        );
      })
      .related('participants')
      .related('channel')
      .one();
  }),
  userCanvases: defineQuery(
    z.object({ includeQuartoDocs: z.boolean().optional() }).optional(),
    ({ ctx, args }) => {
      let query = zql.canvases.where(helpers => {
        return helpers.or(
          helpers.cmp('createdBy', ctx.userID),
          helpers.exists('participants', p => p.where('userId', ctx.userID)),
        );
      });

      // By default, exclude Quarto docs from regular canvas list
      // Also include docs with null docType (legacy data) as Canvas
      if (!args?.includeQuartoDocs) {
        query = query.where(helpers =>
          helpers.or(helpers.cmp('docType', DocType.Canvas), helpers.cmp('docType', 'IS', null)),
        );
      }

      return query.orderBy('updatedAt', 'desc').related('participants').related('channel');
    },
  ),
  // Query for user's Quarto docs
  userQuartoDocs: defineQuery(({ ctx }) => {
    return zql.canvases
      .where('docType', DocType.Quarto)
      .where(helpers => {
        return helpers.or(
          helpers.cmp('createdBy', ctx.userID),
          helpers.exists('participants', p => p.where('userId', ctx.userID)),
        );
      })
      .orderBy('updatedAt', 'desc')
      .related('participants')
      .related('channel');
  }),
  // Query for all user groups with member counts
  getAllUserGroups: defineQuery(() => {
    return zql.user_groups.orderBy('createdAt', 'desc');
  }),
  // Query for all resources
  getAllResources: defineQuery(() => {
    return zql.resources.orderBy('name', 'asc');
  }),
  // Query for resource access for a specific user
  getResourceAccessForUser: defineQuery(
    z.object({ userId: z.string() }),
    ({ args: { userId } }) => {
      return zql.resource_access.where('userId', userId);
    },
  ),
  // Query for members of a specific user group
  getUserGroupMembers: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.user_group_mappings.where('userGroupId', userGroupId).orderBy('createdAt', 'desc');
    },
  ),
  // Query for user group mappings by user ID
  getUserGroupMappingsByUserId: defineQuery(({ ctx }) => {
    return zql.user_group_mappings.where('userId', ctx.userID);
  }),
  // Query for user's bookmarks
  userBookmarks: defineQuery(() => {
    return zql.bookmarks.orderBy('createdAt', 'desc');
  }),
  // Query for attachments from initial message only - used when creating ticket from conversation
  attachmentsByInitialMessage: defineQuery(
    z.object({ initialMessageId: z.string() }),
    ({ args: { initialMessageId } }) => {
      return zql.message_attachments
        .where('entityId', initialMessageId)
        .where('entityType', AttachmentEntityType.CHAT)
        .orderBy('createdAt', 'desc');
    },
  ),
  // Query for attachments by ticket ID - used for displaying ticket attachments
  attachmentsByTicket: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.message_attachments
      .where('entityId', ticketId)
      .where('entityType', AttachmentEntityType.TICKET)
      .orderBy('createdAt', 'desc');
  }),
  attachmentsByImpact: defineQuery(z.object({ impactId: z.string() }), ({ args: { impactId } }) => {
    return zql.message_attachments
      .where('entityId', impactId)
      .where('entityType', AttachmentEntityType.IMPACT)
      .orderBy('createdAt', 'desc');
  }),
  attachmentsByImpactIds: defineQuery(
    z.object({ impactIds: z.array(z.string()) }),
    ({ args: { impactIds } }) => {
      if (impactIds.length === 0) {
        return zql.message_attachments.where('id', '__none__');
      }
      return zql.message_attachments
        .where('entityType', AttachmentEntityType.IMPACT)
        .where(helpers => helpers.or(...impactIds.map(id => helpers.cmp('entityId', '=', id))))
        .orderBy('createdAt', 'desc');
    },
  ),
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
            .where(helpers =>
              helpers.or(
                helpers.cmp('participationType', ConversationParticipation.AUTHOR),
                helpers.cmp('userId', ctx.userID),
              ),
            )
            .orderBy('joinedAt', 'asc'),
        )
        .related('ticket');

      // Apply ordering based on direction
      const orderDirection = direction === 'forward' ? 'desc' : 'asc';
      query = query.orderBy('createdAt', orderDirection);

      // Apply cursor pagination if start is provided
      if (start) {
        query = query.start(
          { conversationId: start.conversationId, createdAt: start.createdAt },
          { inclusive: direction === 'forward' },
        );
      }

      // Apply limit
      return limit ? query.limit(limit) : query;
    },
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
            .where(helpers =>
              helpers.or(
                helpers.cmp('participationType', ConversationParticipation.AUTHOR),
                helpers.cmp('userId', ctx.userID),
              ),
            )
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
    },
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
        exists('conversation', conv =>
          conv.where('channelId', channelId).where(({ or, exists }) =>
            or(
              exists('channel', c => c.where('visibility', '=', ChannelVisibility.PUBLIC), {
                flip: true,
              }),
              exists(
                'channel',
                c =>
                  c.whereExists(
                    'participants',
                    v => v.where('userId', ctx.userID).where('channelId', channelId),
                    { flip: true },
                  ),
                { flip: true },
              ),
            ),
          ),
        ),
      );

      if (start) {
        query = query.start(
          { id: start.attachementId, createdAt: start.createdAt },
          { inclusive: true },
        );
      }

      query = query.orderBy('createdAt', direction === 'forward' ? 'desc' : 'asc');

      if (limit) {
        query = query.limit(limit);
      }

      return query;
    },
  ),
  getPinnedMesseges: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .where('pinned', true)
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
        .related('ticket')
        .related('participants', participantQuery =>
          participantQuery
            .where('participationType', ConversationParticipation.AUTHOR)
            .orderBy('joinedAt', 'asc'),
        );
    },
  ),
  channelLatestMessage: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
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
        .orderBy('createdAt', 'desc')
        .one();
    },
  ),
  conversationOfUserChannels: defineQuery(({ ctx }) => {
    return zql.channels
      .where(helpers => {
        return helpers.exists('participantsStatus', p => {
          return p.where('isClosed', false).where('userId', ctx.userID);
        });
      })
      .related('conversations', c => c.orderBy('createdAt', 'desc').limit(10));
  }),
  // Query for user group by ID
  getUserGroupById: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.user_groups.where('id', userGroupId).one();
    },
  ),
  // Query for board by ID with related project
  getBoardById: defineQuery(z.object({ boardId: z.string() }), ({ args: { boardId } }) => {
    return zql.boards.where('id', boardId).related('project').one();
  }),
  // Query for board detail by ID with stages, form context mappings, and form fields
  // Used when a single board is selected to get stages and dynamic form fields
  boardDetailById: defineQuery(z.object({ boardId: z.string() }), ({ args: { boardId } }) => {
    return zql.boards
      .where('id', boardId)
      .related('stages', stagesQuery =>
        stagesQuery
          .orderBy('sequenceNumber', 'asc')
          .related('approvers')
          .related('formContextMappings', fcm => fcm.related('form')),
      )
      .related('formContextMappings', mappingQuery => mappingQuery.related('formFields'))
      .one();
  }),
  // Query for all ticket entity mappings
  getAllTicketEntityMappings: defineQuery(() => {
    return zql.ticket_entity_mappings;
  }),
  // Query for all ticket tags
  getAllTicketTags: defineQuery(() => {
    return zql.ticket_tags;
  }),
  // Query for ticket entity mappings by ticket ID
  getTicketEntityMappingsByTicketId: defineQuery(
    z.object({ ticketId: z.string() }),
    ({ args: { ticketId } }) => {
      return zql.ticket_entity_mappings.where('ticketId', ticketId);
    },
  ),
  // Query for stages by multiple board IDs
  getStagesByBoardIds: defineQuery(
    z.object({ boardIds: z.array(z.string()) }),
    ({ args: { boardIds } }) => {
      if (boardIds.length === 0) {
        return zql.stages.where('id', 'nonexistent').limit(0);
      }
      return zql.stages.where('boardId', 'IN', boardIds).orderBy('sequenceNumber', 'asc');
    },
  ),
  // Query for user assignment states (on-call status) in a user group
  getUserAssignmentStates: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.user_assignment_states.where('userGroupId', userGroupId);
    },
  ),
  // Query for all assignment states for a user across all groups
  getUserAssignmentStatesByUserId: defineQuery(
    z.object({ userId: z.string() }),
    ({ args: { userId } }) => {
      return zql.user_assignment_states.where('userId', userId);
    },
  ),
  // Query for board complexity scores for a user group
  getBoardComplexityScores: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.board_complexity_scores.where('userGroupId', userGroupId).related('board');
    },
  ),
  // Query for user expertise mappings for a board
  getUserExpertiseMappings: defineQuery(
    z.object({ userGroupId: z.string(), boardId: z.string() }),
    ({ args: { userGroupId, boardId } }) => {
      return zql.user_expertise_mappings
        .where('userGroupId', userGroupId)
        .where('boardId', boardId);
    },
  ),
  // Query for all repos
  getAllRepos: defineQuery(() => {
    return zql.repos.orderBy('name', 'asc');
  }),
  getAllForms: defineQuery(() => {
    return zql.forms
      .related('formFields')
      .related('formContextMappings')
      .orderBy('createdAt', 'desc');
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
    },
  ),
  // Query to get forms by context type (e.g., BOARD)
  getFormsByContextType: defineQuery(
    z.object({ contextType: z.enum(FormContextType) }),
    ({ args: { contextType } }) => {
      return zql.forms
        .where('contextType', contextType)
        .related('formFields')
        .related('formContextMappings')
        .orderBy('createdAt', 'desc');
    },
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
    },
  ),
  // Dashboard queries
  getAllDashboards: defineQuery(() => {
    return zql.dashboards.orderBy('updatedAt', 'desc');
  }),
  getDashboardById: defineQuery(
    z.object({ dashboardId: z.string() }),
    ({ args: { dashboardId } }) => {
      return zql.dashboards
        .where('id', dashboardId)
        .related('queryMappings', mapping => mapping.related('query'))
        .one();
    },
  ),

  // Custom Emoji Queries
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

  // RCA Queries
  allRCAsPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ createdAt: z.number(), id: z.string() }).nullable(),
    }),
    ({ args: { limit, start } }) => {
      let query = zql.rcas.orderBy('createdAt', 'desc').related('ticket');

      if (start) {
        query = query.start({ createdAt: start.createdAt, id: start.id }, { inclusive: false });
      }

      return query.limit(limit);
    },
  ),

  rcaById: defineQuery(z.object({ rcaId: z.string() }), ({ args: { rcaId } }) => {
    return zql.rcas.where('id', rcaId).related('impacts').related('coes').related('ticket').one();
  }),

  rcaByTicketId: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.rcas
      .where('ticketId', ticketId)
      .related('impacts')
      .related('coes')
      .related('ticket')
      .one();
  }),

  releaseAttributionsByTicketId: defineQuery(
    z.object({ ticketId: z.string() }),
    ({ args: { ticketId } }) => {
      return zql.release_attributions.where('ticketId', ticketId).orderBy('createdAt', 'desc');
    },
  ),

  releaseTickets: defineQuery(() => {
    return zql.tickets.where('ticketType', BaseTicketType.Release).orderBy('createdAt', 'desc');
  }),
  releaseTicketsSearch: defineQuery(
    z.object({
      search: z.string().optional(),
      limit: z.number().optional(),
    }),
    ({ args: { search, limit } }) => {
      let query = zql.tickets
        .where('ticketType', BaseTicketType.Release)
        .orderBy('createdAt', 'desc');
      if (search && search.trim()) {
        const searchValue = `%${search.trim()}%`;
        query = query.where(helpers =>
          helpers.or(
            helpers.cmp('xyneId', 'ILIKE', searchValue),
            helpers.cmp('title', 'ILIKE', searchValue),
          ),
        );
      }
      return query.limit(limit ?? 10);
    },
  ),

  ticketsSearch: defineQuery(
    z.object({
      search: z.string().optional(),
      limit: z.number().optional(),
    }),
    ({ args: { search, limit } }) => {
      let query = zql.tickets
        .where(helpers => helpers.cmp('ticketType', '!=', BaseTicketType.Release))
        .orderBy('createdAt', 'desc');
      if (search && search.trim()) {
        const searchValue = `%${search.trim()}%`;
        query = query.where(helpers =>
          helpers.or(
            helpers.cmp('xyneId', 'ILIKE', searchValue),
            helpers.cmp('title', 'ILIKE', searchValue),
          ),
        );
      }
      return query.limit(limit ?? 10);
    },
  ),

  subTicketsByIds: defineQuery(
    z.object({ subTicketIds: z.array(z.string()) }),
    ({ args: { subTicketIds } }) => {
      return zql.sub_tickets.where(helpers => helpers.cmp('id', 'IN', subTicketIds));
    },
  ),

  subTicketsByMappedTicketIds: defineQuery(
    z.object({ mappedTicketIds: z.array(z.string()) }),
    ({ args: { mappedTicketIds } }) => {
      return zql.sub_tickets.where(helpers => helpers.cmp('mappedTicketId', 'IN', mappedTicketIds));
    },
  ),

  getTicketStageRequests: defineQuery(
    z.object({ ticketId: z.string() }),
    ({ args: { ticketId } }) => {
      return zql.ticket_stage_requests.where('ticketId', ticketId).orderBy('createdAt', 'desc');
    },
  ),

  // Recap Queries
  channelDailyRecaps: defineQuery(
    z.object({
      channelIds: z.array(z.string()),
      recapDate: z.number(),
    }),
    ({ args: { channelIds, recapDate } }) => {
      if (channelIds.length === 0) {
        return zql.channel_daily_recaps.limit(0);
      }

      return zql.channel_daily_recaps
        .where('recapDate', recapDate)
        .where(helpers => helpers.or(...channelIds.map(id => helpers.cmp('channelId', id))));
    },
  ),

  entityNudges: defineQuery(
    z.object({
      sourceId: z.string(),
      states: z.array(z.string()).optional(),
    }),
    ({ ctx, args: { sourceId, states } }) => {
      const effectiveStates =
        states && states.length > 0 ? states.map(s => s as NudgeState) : [NudgeState.ACTIVE];

      let query = zql.surface_nudges
        .where('sourceId', sourceId)
        .where(h => h.or(h.cmp('visibleTo', 'IS', null), h.cmp('visibleTo', '=', ctx.userID)));

      if (effectiveStates.length === 1) {
        const singleState = effectiveStates[0];
        if (singleState) {
          query = query.where('state', singleState);
        }
      } else {
        query = query.where(h => h.or(...effectiveStates.map(v => h.cmp('state', '=', v))));
      }

      return query.orderBy('createdAt', 'asc');
    },
  ),
});
