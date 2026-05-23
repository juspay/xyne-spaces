import { createBuilder, defineQueries } from '@rocicorp/zero';
import { BaseTicketType } from '../tickets/types.js';
import { defineQuery } from './acl/define-query.js';
import {
  CallType,
  FormContextType,
  FormEntityType,
  LookupType,
  SavedConfigContextType,
} from './schema.js';
import { z } from 'zod';
import {
  ActivityClassification,
  AttachmentEntityType,
  CallStatus,
  CanvasVisibility,
  ChannelRole,
  ChannelVisibility,
  ChannelType,
  ChannelScopeType,
  ConversationParticipation,
  DocType,
  schema,
  LinkVisibility,
  NudgeState,
  Status,
  TicketPriority,
  DelayedMessageStatus,
  RecapEntityType,
} from './schema.js';

export const zql = createBuilder(schema);

const applyCanvasVisibilityQueryFilter = (
  query: any,
  userId: string,
  requestedCanvasId?: string,
  includePublicVisibility = true,
) =>
  query.where((helpers: any) =>
    helpers.or(
      helpers.cmp('createdBy', userId),
      helpers.exists('participants', (participant: any) => participant.where('userId', userId)),
      helpers.exists('participants', (p: any) =>
        p.whereExists('userGroup', (ug: any) =>
          ug.whereExists('userGroupMappings', (m: any) => m.where('userId', userId)),
        ),
      ),
      ...(includePublicVisibility ? [helpers.cmp('visibility', CanvasVisibility.PUBLIC)] : []),
      ...(requestedCanvasId
        ? [
            helpers.cmp('viewAccessId', requestedCanvasId),
            helpers.cmp('editAccessId', requestedCanvasId),
          ]
        : []),
    ),
  );


export const queries = defineQueries({
  channelConversations: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean() }),
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
            .related('attachments')
            .related('nudgeCounts', nudgeCountsQuery =>
              nudgeCountsQuery.where(helpers =>
                helpers.or(
                  helpers.cmp('userId', '=', ctx.userID),
                  helpers.cmp('channelId', '=', channelId),
                ),
              ),
            ),
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
  channelConversationsV2: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean() }),
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
            .related('attachments')
            .related('nudgeCounts', nudgeCountsQuery =>
              nudgeCountsQuery.where(helpers =>
                helpers.or(
                  helpers.cmp('userId', '=', ctx.userID),
                  helpers.cmp('channelId', '=', channelId),
                ),
              ),
            ),
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
        .related('reactions')
        .related('nudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery.where(helpers =>
            helpers.or(
              helpers.cmp('userId', '=', ctx.userID),
              helpers.cmp('channelId', 'IS NOT', null),
            ),
          ),
        );
    },
  ),
  conversationMessagesV2: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ ctx, args: { conversationId } }) => {
      return zql.messages
        .where('conversationId', conversationId)
        .where(helpers => {
          return helpers.or(
            helpers.cmp('visibleTo', 'IS', null),
            helpers.cmp('visibleTo', '=', ctx.userID),
          );
        })
        .orderBy('createdAt', 'asc')
        .related('attachments')
        .related('nudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery.where(helpers =>
            helpers.or(
              helpers.cmp('userId', '=', ctx.userID),
              helpers.cmp('channelId', 'IS NOT', null),
            ),
          ),
        );
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

  surfaceNudgesByCountRowIds: defineQuery(
    z.object({
      countRowIds: z.array(z.string()),
    }),
    ({ ctx, args: { countRowIds } }) => {
      let query = zql.surface_nudges.where(helpers =>
        helpers.or(
          ...countRowIds.map(countRowId => helpers.cmp('surfaceNudgeCountId', '=', countRowId)),
        ),
      );

      query = query.where('state', '=', NudgeState.ACTIVE);

      query = query.where(helpers =>
        helpers.or(helpers.cmp('visibleTo', 'IS', null), helpers.cmp('visibleTo', '=', ctx.userID)),
      );

      return query.orderBy('createdAt', 'asc');
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


  // If channel Id is available use this instead of getConversationById to leverage ACL optimizations for channel conversations
  getConversationByIdWithChannel: defineQuery(
    z.object({ conversationId: z.string(), channelId: z.string(), isMember: z.boolean() }),
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
        .related('ticket', t => t.related('attachments'))
        .one();
    },
  ),


  // Enriched single query for thread panel — replaces getConversationById + ticketById +
  // conversationMessagesV2 with one query and one IVM pipeline (4 queries → 1).
  threadConversation: defineQuery(
    z.object({
      conversationId: z.string(),
      channelId: z.string().optional(),
      isMember: z.boolean().optional(),
    }),
    ({ ctx, args: { conversationId } }) => {
      return zql.conversations
        .where('conversationId', conversationId)
        .related('ticket', t => t.related('attachments'))
        .related('call')
        .related('participants', p =>
          p.where('userId', ctx.userID).one(),
        )
        .related('messages', m =>
          m.where(helpers =>
            helpers.or(
              helpers.cmp('visibleTo', 'IS', null),
              helpers.cmp('visibleTo', '=', ctx.userID),
            ),
          )
          .orderBy('createdAt', 'asc')
          .related('attachments')
          .related('nudgeCounts', nc =>
            nc.where(helpers =>
              helpers.or(
                helpers.cmp('userId', '=', ctx.userID),
                helpers.cmp('channelId', 'IS NOT', null),
              ),
            ),
          ),
        )
        .one();
    },
  ),

  conversationParticipantByConversationId: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ ctx, args: { conversationId } }) => {
      return zql.conversation_participants
        .where('conversationId', conversationId)
        .where('userId', ctx.userID)
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
    z.object({ channelId: z.string(), isMember: z.boolean(), timestamp: z.number() }),
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

      // Exclude Support tickets from regular board/project views
      // Support tickets are handled by IT Support Workflow
      // Allow NULL ticketType values (NULL != 'Support' evaluates to NULL, not TRUE)
      query = query.where(helpers =>
        helpers.or(
          helpers.cmp('ticketType', 'IS', null),
          helpers.cmp('ticketType', '!=', BaseTicketType.Support),
        ),
      );

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
  // Unified query for Xyne Desk: tickets scoped to a single channel.
  // channelId + isMember are required and forwarded to TicketsACL for membership gating.
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
        .related('conversation', c => c.related('channel'));
    },
  ),
  supportTicketsFilteredV2: defineQuery(
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      merchantMid: z.string().optional(),
      assignedTo: z.array(z.string()).optional(),
      priority: z.array(z.nativeEnum(TicketPriority)).optional(),
      stageName: z.array(z.string()).optional(),
    }),
    ({ args: { channelId, merchantMid, assignedTo, priority, stageName } }) => {
      let query = zql.tickets.where('channelId', channelId);

      if (merchantMid) {
        query = query.where('merchantId', merchantMid);
      }

      if (assignedTo && assignedTo.length > 0) {
        query = query.where(({ or, cmp }) => or(...assignedTo.map((id) => cmp('assignedTo', id))));
      }

      if (priority && priority.length > 0) {
        query = query.where(({ or, cmp }) => or(...priority.map((p) => cmp('priority', p))));
      }

      if (stageName && stageName.length > 0) {
        query = query.where(({ or, cmp }) => or(...stageName.map((s) => cmp('stageName', s))));
      }

      return query
        .orderBy('createdAt', 'desc')
        .related('project')
        .related('tags')
        .related('entity')
        .related('conversation', c => c.related('channel'));
    },
  ),
  // Single-row variant matching supportTicketsPage row shape (for @rocicorp/zero-virtual permalinks).
  // channelId + isMember are forwarded to TicketsACL for membership gating.
  // emailDrafts is scoped to the current user (drafts are per-user private).
  supportTicketRow: defineQuery(z.object({ id: z.string() }), ({ args: { id } }) => {
    return zql.tickets
      .where('id', id)
      .related('project')
      .related('tags')
      .related('entity')
      .related('emails')
      .related('conversation')
      .one();
  }),
  supportTicketRowV2: defineQuery(
    z.object({ id: z.string(), channelId: z.string(), isMember: z.boolean() }),
    ({ ctx, args: { id } }) => {
      return zql.tickets
        .where('id', id)
        .related('project')
        .related('tags')
        .related('entity')
        .related('emails', q => q.related('attachments'))
        .related('emailDrafts', q =>
          q.where(({ or, cmp }) =>
            or(cmp('userId', '=', ctx.userID), cmp('userId', 'IS', null)),
          ),
        )
        .related('emailReads', q => q.where('userId', ctx.userID))
        .related('conversation')
        .one();
    },
  ),
  supportTicketByXyneId: defineQuery(
    z.object({ xyneId: z.string() }),
    ({ args: { xyneId } }) => {
      return zql.tickets
        .where('xyneId', xyneId)
        .related('project')
        .related('tags')
        .related('entity')
        .related('emails')
        .related('conversation')
        .one();
    },
  ),
  supportTicketByXyneIdV2: defineQuery(
    z.object({ xyneId: z.string(), channelId: z.string(), isMember: z.boolean() }),
    ({ ctx, args: { xyneId } }) => {
      return zql.tickets
        .where('xyneId', xyneId)
        .related('project')
        .related('tags')
        .related('entity')
        .related('emails', q => q.related('attachments'))
        .related('emailDrafts', q =>
          q.where(({ or, cmp }) =>
            or(cmp('userId', '=', ctx.userID), cmp('userId', 'IS', null)),
          ),
        )
        .related('emailReads', q => q.where('userId', ctx.userID))
        .related('conversation')
        .one();
    },
  ),
  supportTicketByXyneIdV3: defineQuery(
    z.object({ xyneId: z.string(), workspaceId: z.string(), channelId: z.string(), isMember: z.boolean() }),
    ({ ctx, args: { xyneId, workspaceId } }) => {
      return zql.tickets
        .where('xyneId', xyneId)
        .where('workspaceId', workspaceId)
        .related('project')
        .related('tags')
        .related('entity')
        .related('emails', q => q.related('attachments'))
        .related('emailDrafts', q =>
          q.where(({ or, cmp }) =>
            or(cmp('userId', '=', ctx.userID), cmp('userId', 'IS', null)),
          ),
        )
        .related('emailReads', q => q.where('userId', ctx.userID))
        .related('conversation')
        .one();
    },
  ),
  // Paginated variant of supportTicketsFiltered for use with @rocicorp/zero-virtual.
  // Cursor = (lastEmailAt, id) matching the orderBy. Active threads bubble up.
  // channelId + isMember are forwarded to TicketsACL for membership gating.
  supportTicketsPage: defineQuery(
    z.object({
      channelId: z.string().optional(),
      assignedTo: z.string().optional(),
      limit: z.number(),
      start: z.object({ id: z.string(), createdAt: z.number() }).nullable(),
      dir: z.literal('forward').or(z.literal('backward')),
    }),
    ({ args: { channelId, assignedTo, limit, start, dir } }) => {
      let query = zql.tickets;

      if (channelId) {
        query = query.where('channelId', channelId);
      } else {
        query = query.whereExists('channel', (channel) => channel.where('type', ChannelType.EMAIL));
      }

      if (assignedTo) {
        query = query.where('assignedTo', assignedTo);
      }

      const orderDirection = dir === 'forward' ? 'desc' : 'asc';
      query = query.orderBy('createdAt', orderDirection);

      if (start) {
        query = query.start(
          { createdAt: start.createdAt, id: start.id },
          { inclusive: false },
        );
      }

      return query
        .limit(limit)
        .related('project')
        .related('tags')
        .related('entity')
        .related('emails')
        .related('conversation');
    },
  ),
  supportTicketsPageV2: defineQuery(
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      assignedTo: z.array(z.string()).optional(),
      priority: z.array(z.nativeEnum(TicketPriority)).optional(),
      stageName: z.array(z.string()).optional(),
      limit: z.number(),
      start: z.object({ id: z.string(), lastEmailAt: z.number() }).nullable(),
      dir: z.literal('forward').or(z.literal('backward')),
    }),
    ({ ctx, args: { channelId, assignedTo, priority, stageName, limit, start, dir } }) => {
      let query = zql.tickets.where('channelId', channelId);

      if (assignedTo && assignedTo.length > 0) {
        query = query.where(({ or, cmp }) => or(...assignedTo.map((id) => cmp('assignedTo', id))));
      }

      if (priority && priority.length > 0) {
        query = query.where(({ or, cmp }) => or(...priority.map((p) => cmp('priority', p))));
      }

      if (stageName && stageName.length > 0) {
        query = query.where(({ or, cmp }) => or(...stageName.map((s) => cmp('stageName', s))));
      }

      const orderDirection = dir === 'forward' ? 'desc' : 'asc';
      query = query.orderBy('lastEmailAt', orderDirection);

      if (start) {
        query = query.start(
          { lastEmailAt: start.lastEmailAt, id: start.id },
          { inclusive: false },
        );
      }

      return query
        .limit(limit)
        .related('project')
        .related('tags')
        .related('entity')
        .related('emails', q => q.related('attachments'))
        .related('emailDrafts', q =>
          q.where(({ or, cmp }) =>
            or(cmp('userId', '=', ctx.userID), cmp('userId', 'IS', null)),
          ),
        )
        .related('emailReads', q => q.where('userId', ctx.userID))
        .related('conversation');
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
    ({ ctx, args: { conversationId } }) => {
      return zql.email_drafts
        .where('conversationId', conversationId)
        .where(({ or, cmp }) =>
          or(cmp('userId', '=', ctx.userID), cmp('userId', 'IS', null)),
        )
        .orderBy('updatedAt', 'desc');
    },
  ),
  getEmailChannelPreference: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.email_channel_preferences.where('channelId', channelId);
    },
  ),
  getClassificationMappings: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.classification_mappings.where('channelId', channelId).orderBy('createdAt', 'asc');
    },
  ),
  getBoardSlaPolicies: defineQuery(
    z.object({ boardId: z.string() }),
    ({ args: { boardId } }) => {
      return zql.board_sla_policies.where('boardId', boardId).where('isActive', true);
    },
  ),
  /**
   * Fetches active SLA policies for multiple boards in a single query.
   * Use this at the board/screen level instead of per-card fetches to avoid
   * N identical subscriptions when displaying a list of tickets.
   */
  getBoardSlaPoliciesByBoardIds: defineQuery(
    z.object({ boardIds: z.array(z.string()) }),
    ({ args: { boardIds } }) => {
      if (boardIds.length === 0) {
        return zql.board_sla_policies.where('id', 'nonexistent').limit(0);
      }
      return zql.board_sla_policies
        .where('boardId', 'IN', boardIds)
        .where('isActive', true);
    },
  ),
  getCurrentUserPreference: defineQuery(z.object({}), ({ ctx }) => {
    return zql.user_preferences.where('userId', ctx.userID).one();
  }),
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
  ticketDetailsById: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
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
      .related('rcas', rcaQuery => rcaQuery.orderBy('createdAt', 'desc').limit(1))
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
  ticketByXyneIdV2: defineQuery(z.object({ xyneId: z.string(), workspaceId: z.string() }), ({ args: { xyneId, workspaceId } }) => {
    return zql.tickets
      .where('xyneId', xyneId)
      .where('workspaceId', workspaceId)
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
  userAllChannels: defineQuery(
    z.object({ updatedAt: z.number().optional() }).optional(),
    ({ args }) => {
      let query = zql.channels;
      if (args?.updatedAt !== undefined) {
        query = query.where('updatedAt', '>', args.updatedAt);
      }
      return query;
    },
  ),
  userVisibleChannels: defineQuery(({ ctx }) => {
    return zql.channels
      .whereExists('participantsStatus', p =>
        p.where('isClosed', false).where('isDeleted', false).where('userId', ctx.userID),
      )
      .related('channelStats');
  }),
  channelStats: defineQuery(z.object({ channelId: z.string() }), ({ args: { channelId } }) => {
    return zql.channel_stats.where('channelId', channelId).one();
  }),
  channelStatsByIds: defineQuery(
    z.object({ channelIds: z.array(z.string()) }),
    ({ args: { channelIds } }) => {
      return zql.channel_stats.where(helpers =>
        helpers.or(...channelIds.map(id => helpers.cmp('channelId', '=', id))),
      );
    },
  ),
  userVisibleChannelsV2: defineQuery(({ ctx }) => {
    return zql.channel_user_status
      .where('userId', ctx.userID)
      .where('isClosed', false)
      .where('isDeleted', false)
      .related('channel', ch => ch.related('channelStats'));
  }),
  projectsByIds: defineQuery(
    z.object({ projectIds: z.array(z.string()) }),
    ({ args: { projectIds } }) => {
      return zql.projects.where(helpers => helpers.cmp('id', 'IN', projectIds));
    },
  ),
  channelParticipants: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.channel_participants.where('channelId', channelId);
    },
  ),
  myChannelParticipations: defineQuery(z.object({}), ({ ctx }) => {
    return zql.channel_participants.where('userId', ctx.userID).where('role', ChannelRole.ADMIN);
  }),
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
  userConversationsPaginatedV2: defineQuery(
    z.object({
      userId: z.string(),
      limit: z.number(),
      start: z.object({ lastReplyAt: z.number(), id: z.string() }).nullable(),
    }),
    ({ args: { userId, limit, start } }) => {
      let query = zql.conversation_participants
        .where('userId', userId)
        .where('lastReplyAt', 'IS NOT', null)
        .where('isSubscribed', true)
        .orderBy('lastReplyAt', 'desc');

      if (start) {
        query = query.start(
          { lastReplyAt: start.lastReplyAt, id: start.id },
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
    },
  ),
  getUserMultipleChannelParticipations: defineQuery(
    z.object({ channelIds: z.array(z.string()) }),
    ({ ctx, args: { channelIds } }) => {
      if (channelIds.length === 0) {
        // Return empty query if no channel IDs provided
        return zql.channel_user_status.where('channelId', 'nonexistent').limit(0);
      }

      return zql.channel_user_status
        .where('userId', ctx.userID)
        .where('isDeleted', false)
        .where(helpers => {
          return helpers.cmp('channelId', 'IN', channelIds);
        });
    },
  ),
  getAllChannelsUserStatus: defineQuery(({ ctx }) => {
    return zql.channel_user_status.where('userId', ctx.userID).where('isDeleted', false);
  }),
  getUsers: defineQuery(z.object({ updatedAt: z.number().optional() }).optional(), ({ args }) => {
    let query = zql.users;
    if (args?.updatedAt !== undefined) {
      query = query.where(helpers =>
        helpers.or(
          helpers.cmp('updatedAt', '>', args.updatedAt),
          helpers.exists('presenceStatus', p => p.where('updatedAt', '>', args.updatedAt)),
        ),
      );
    }
    return query.related('presenceStatus');
  }),
  getUsersV2: defineQuery(z.object({ updatedAt: z.number().optional() }).optional(), ({ args }) => {
    let query = zql.users;
    if (args?.updatedAt !== undefined) {
      query = query.where('updatedAt', '>', args.updatedAt);
    }
    return query;
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
  userCallHistory: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), startedAt: z.number() }).nullable(),
    }),
    ({ args: { limit, start } }) => {
      let query = zql.calls
        .where(helpers => helpers.cmp('callType', 'NOT IN', [CallType.HEADLESS]))
        .where(helpers =>
          helpers.cmp('status', 'NOT IN', [CallStatus.SCHEDULED, CallStatus.CANCELLED]),
        )
        .orderBy('startedAt', 'desc')
        .orderBy('id', 'desc');

      if (start) {
        query = query.start({ id: start.id, startedAt: start.startedAt }, { inclusive: false });
      }

      return query.limit(limit).related('participants');
    },
  ),

  userRecordings: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), startedAt: z.number() }).nullable(),
    }),
    ({ args: { limit, start } }) => {
      let query = zql.calls
        .where('callType', CallType.HEADLESS)
        .orderBy('startedAt', 'desc')
        .orderBy('id', 'desc');

      if (start) {
        query = query.start({ id: start.id, startedAt: start.startedAt }, { inclusive: false });
      }

      return query.limit(limit);
    },
  ),

  recurringSeriesById: defineQuery(z.object({ seriesId: z.string() }), ({ args: { seriesId } }) => {
    return zql.recurring_call_series.where('id', seriesId).one();
  }),

  userActivities: defineQuery(() => {
    return zql.activities
      .orderBy('updatedAt', 'desc')
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
  userActivitiesV2: defineQuery(() => {
    return zql.activities
      .orderBy('updatedAt', 'desc')
      .related('message', m => m.related('conversation').related('attachments'))
      .related('reaction')
      .related('canvas')
      .related('ticket');
  }),
  userActivitiesPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
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

      query = query.orderBy('updatedAt', 'desc').orderBy('id', 'desc');

      if (start) {
        query = query.start({ id: start.id, updatedAt: start.updatedAt }, { inclusive: false });
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
  userActivitiesPaginatedV2: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
      types: z.array(z.string()),
      classification: z.array(z.nativeEnum(ActivityClassification)).optional(),
      isRead: z.boolean().optional(),
    }),
    ({ args: { limit, start, types, classification, isRead } }) => {
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

      if (isRead !== undefined) {
        query = query.where('isRead', isRead);
      }

      query = query.orderBy('updatedAt', 'desc').orderBy('id', 'desc');

      if (start) {
        query = query.start({ id: start.id, updatedAt: start.updatedAt }, { inclusive: false });
      }

      return query
        .limit(limit)
        .related('message', m => m.related('conversation').related('attachments'))
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
    return zql.activities.where('isRead', false).orderBy('updatedAt', 'desc').related('channel');
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
  getMessageForActivityV2: defineQuery(
    z.object({ messageId: z.string() }),
    ({ args: { messageId } }) => {
      return zql.messages
        .where('messageId', messageId)
        .related('conversation')
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

  channelCanvasFolders: defineQuery(
    z.object({
      channelId: z.string(),
    }),
    ({ args: { channelId } }) => {
      return zql.canvas_folders.where('channelId', channelId).orderBy('name', 'asc');
    },
  ),

  projectCanvasFolders: defineQuery(
    z.object({
      projectId: z.string(),
    }),
    ({ args: { projectId } }) => {
      return zql.canvas_folders
        .where('projectId', projectId)
        .where('channelId', 'IS', null)
        .orderBy('name', 'asc');
    },
  ),
  
  projectFolderCanvases: defineQuery(
    z.object({
      folderId: z.string(),
      projectId: z.string(),
      includeQuartoDocs: z.boolean().optional(),
    }),
    ({ ctx, args: { folderId, projectId, includeQuartoDocs } }) => {
      let query = zql.canvases
        .where('folderId', folderId)
        .where('projectId', projectId)
        .where('channelId', 'IS', null);

      if (!includeQuartoDocs) {
        query = query.where('docType', DocType.Canvas);
      }

      return applyCanvasVisibilityQueryFilter(query, ctx.userID).orderBy('updatedAt', 'desc');
    },
  ),
  channelCanvasesPaginated: defineQuery(
    z.object({
      channelId: z.string(),
      includeQuartoDocs: z.boolean().optional(),
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
      direction: z.enum(['forward', 'backward']).optional(),
    }),
    ({ ctx, args: { channelId, includeQuartoDocs, limit, start, direction } }) => {
      const isBackward = direction === 'backward';
      let query = zql.canvases.where('channelId', channelId);

      if (!includeQuartoDocs) {
        query = query.where('docType', DocType.Canvas);
      }

      query = applyCanvasVisibilityQueryFilter(query, ctx.userID);

      query = query.orderBy('updatedAt', isBackward ? 'asc' : 'desc').orderBy(
        'id',
        isBackward ? 'asc' : 'desc',
      );

      if (start) {
        query = query.start(
          { id: start.id, updatedAt: start.updatedAt },
          { inclusive: !isBackward },
        );
      }

      return query.limit(limit).related('participants');
    },
  ),

  channelQuartoDocsPaginated: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
    }),
    ({ args: { channelId, limit, start } }) => {
      let query = zql.canvases
        .where('channelId', channelId)
        .where('docType', DocType.Quarto)
        .orderBy('updatedAt', 'desc')
        .orderBy('id', 'desc');

      if (start) {
        query = query.start({ updatedAt: start.updatedAt, id: start.id }, { inclusive: false });
      }

      return query.limit(limit).related('participants').related('channel');
    },
  ),


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
        .related('reactionCounts')
        .related('reactions')
        .related('attachments')
        .related('nudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery.where(helpers =>
            helpers.or(
              helpers.cmp('userId', '=', ctx.userID),
              helpers.cmp('channelId', '=', channelId),
            ),
          ),
        );
    },
  ),
  channelAndThreadMessagesV2: defineQuery(
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
        .related('nudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery.where(helpers =>
            helpers.or(
              helpers.cmp('userId', '=', ctx.userID),
              helpers.cmp('channelId', '=', channelId),
            ),
          ),
        );
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
  // Lightweight global board list — only scalar fields, no related data.
  // Use this for dropdowns and pickers that only need board id/name.
  // For full board detail (editing), use boardFullDetailById.
  getAllBoardsList: defineQuery(() => {
    return zql.boards.orderBy('createdAt', 'desc');
  }),
  projectById: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) => {
    return zql.projects.where('id', projectId).one();
  }),


  personalCanvasFolders: defineQuery(({ ctx }) => {
    return zql.canvas_folders
      .where('projectId', 'IS', null)
      .where('channelId', 'IS', null)
      .where('createdBy', ctx.userID)
      .orderBy('name', 'asc');
  }),
  hierarchyCanvases: defineQuery(
    z.object({
      scope: z.enum(['channel', 'channel_root', 'folder', 'personal_root']).optional(),
      channelId: z.string().optional(),
      folderId: z.string().optional(),
      projectId: z.string().optional(),
      includeQuartoDocs: z.boolean().optional(),
    }).refine(args => {
      const scope = args.scope ?? (args.folderId ? 'folder' : 'channel');
      if (scope === 'folder') return Boolean(args.folderId) && !args.channelId;
      if (scope === 'personal_root') return !args.folderId && !args.channelId;
      return Boolean(args.channelId) && !args.folderId;
    }, 'Provide folderId for folder scope or channelId for channel scope'),
    ({ ctx, args: { scope, channelId, folderId, includeQuartoDocs } }) => {
      const resolvedScope = scope ?? (folderId ? 'folder' : 'channel');
      let query =
        resolvedScope === 'folder'
          ? zql.canvases.where('folderId', folderId as string)
          : resolvedScope === 'personal_root'
            ? zql.canvases.where(({ and, cmp }) =>
                and(
                  cmp('projectId', 'IS', null),
                  cmp('channelId', 'IS', null),
                  cmp('folderId', 'IS', null),
                ),
              )
          : zql.canvases.where('channelId', channelId as string);

      if (!includeQuartoDocs) {
        query = query.where('docType', DocType.Canvas);
      }

      if (resolvedScope === 'channel_root') {
        query = query.where('folderId', 'IS', null);
      }

      return applyCanvasVisibilityQueryFilter(
        query,
        ctx.userID,
        undefined,
        resolvedScope !== 'personal_root',
      ).orderBy('updatedAt', 'desc');
    },
  ),

  
  ticketsByProject: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) => {
    return zql.tickets
      .where('projectId', projectId)
      .where('isArchived', false)
      .where(helpers => helpers.cmp('ticketType', '!=', BaseTicketType.Support))
      .related('tags')
      .orderBy('createdAt', 'desc');
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
    return applyCanvasVisibilityQueryFilter(
      zql.canvases
      .where(helpers => {
        return helpers.or(
          helpers.cmp('id', canvasId),
          helpers.cmp('viewAccessId', canvasId),
          helpers.cmp('editAccessId', canvasId),
          helpers.cmp('userRepo', canvasId), // Also allow lookup by userRepo
        );
      })
      .related('participants')
      .related('channel'),
      ctx.userID,
      canvasId,
    ).one();
  }),
  userCanvasesPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
      includeQuartoDocs: z.boolean().optional(),
      direction: z.enum(['forward', 'backward']).optional(),
    }),
    ({ ctx, args }) => {
      const isBackward = args.direction === 'backward';
      let query = applyCanvasVisibilityQueryFilter(zql.canvases, ctx.userID, undefined, false);

      if (!args.includeQuartoDocs) {
        query = query.where('docType', DocType.Canvas);
      }

      query = query.orderBy('updatedAt', isBackward ? 'asc' : 'desc').orderBy(
        'id',
        isBackward ? 'asc' : 'desc',
      );

      if (args.start) {
        query = query.start(
          { id: args.start.id, updatedAt: args.start.updatedAt },
          { inclusive: !isBackward },
        );
      }

      return query
        .limit(args.limit)
        .related('participants');
    },
  ),
  // Query for user's Quarto docs
  userQuartoDocsPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
      direction: z.enum(['forward', 'backward']).optional(),
    }),
    ({ ctx, args }) => {
      const isBackward = args.direction === 'backward';
      let query = zql.canvases
        .where('docType', DocType.Quarto)
        .where(helpers => {
          return helpers.or(
            helpers.cmp('createdBy', ctx.userID),
            helpers.exists('participants', p => p.where('userId', ctx.userID)),
            helpers.exists('participants', p =>
              p.whereExists('userGroup', ug =>
                ug.whereExists('userGroupMappings', m => m.where('userId', ctx.userID)),
              ),
            ),
          );
        })
        .orderBy('updatedAt', isBackward ? 'asc' : 'desc')
        .orderBy('id', isBackward ? 'asc' : 'desc');

      if (args.start) {
        query = query.start(
          { id: args.start.id, updatedAt: args.start.updatedAt },
          { inclusive: !isBackward },
        );
      }

      return query
        .limit(args.limit)
        .related('participants');
    },
  ),
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
    return zql.bookmarks.where('isDeleted', false).orderBy('createdAt', 'desc');
  }),
  // Query for user's email signatures
  userEmailSignatures: defineQuery(({ ctx }) => {
    return zql.email_signatures.where('userId', ctx.userID).orderBy('createdAt', 'asc');
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
      isMember: z.boolean(),
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
            .related('attachments')
            .related('nudgeCounts', nudgeCountsQuery =>
              nudgeCountsQuery.where(helpers =>
                helpers.or(
                  helpers.cmp('userId', '=', ctx.userID),
                  helpers.cmp('channelId', '=', channelId),
                ),
              ),
            ),
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
      isMember: z.boolean(),
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
            .related('attachments')
            .related('nudgeCounts', nudgeCountsQuery =>
              nudgeCountsQuery.where(helpers =>
                helpers.or(
                  helpers.cmp('userId', '=', ctx.userID),
                  helpers.cmp('channelId', '=', channelId),
                ),
              ),
            ),
        )
        .related('parentMessage');

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
  channelConversationsPaginatedV3: defineQuery(
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      limit: z.number(),
      start: z.object({ createdAt: z.number() }).nullable(),
      direction: z.literal('forward').or(z.literal('backward')),
    }),
    ({ ctx, args: { channelId, limit, start, direction } }) => {
      let query = zql.conversations
        .where('channelId', channelId)
        .related('initialMessageAttachments')
        .related('ticket', t => t.related('attachments'))
        .related('initialMessageNudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery.where(helpers =>
            helpers.or(
              helpers.cmp('userId', '=', ctx.userID),
              helpers.cmp('channelId', '=', channelId),
            ),
          ),
        );

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
    z.object({ channelId: z.string(), isMember: z.boolean(), limit: z.number() }),
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
            .related('attachments')
            .related('nudgeCounts', nudgeCountsQuery =>
              nudgeCountsQuery.where(helpers =>
                helpers.or(
                  helpers.cmp('userId', '=', ctx.userID),
                  helpers.cmp('channelId', '=', channelId),
                ),
              ),
            ),
        )
        .related('parentMessage')
        .related('participants', participantQuery =>
          participantQuery.where('userId', ctx.userID).orderBy('joinedAt', 'asc'),
        )
        .related('ticket')
        .orderBy('createdAt', 'desc')
        .limit(limit);
    },
  ),
  channelLatestMultipleConversationsV2: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean(), limit: z.number() }),
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
            .related('attachments')
            .related('nudgeCounts', nudgeCountsQuery =>
              nudgeCountsQuery.where(helpers =>
                helpers.or(
                  helpers.cmp('userId', '=', ctx.userID),
                  helpers.cmp('channelId', '=', channelId),
                ),
              ),
            ),
        )
        .related('parentMessage')
        .related('ticket')
        .orderBy('createdAt', 'desc')
        .limit(limit);
    },
  ),
  channelLatestMultipleConversationsV3: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean(), limit: z.number() }),
    ({ ctx, args: { channelId, limit } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .related('initialMessageAttachments')
        .related('ticket', t => t.related('attachments'))
        .related('initialMessageNudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery.where(helpers =>
            helpers.or(
              helpers.cmp('userId', '=', ctx.userID),
              helpers.cmp('channelId', '=', channelId),
            ),
          ),
        )
        .orderBy('createdAt', 'desc')
        .limit(limit);
    },
  ),
  channelLatestConversation: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean() }),
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
    z.object({ channelId: z.string(), isMember: z.boolean() }),
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
  getPinnedMessegesV2: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean() }),
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
    z.object({ channelId: z.string(), isMember: z.boolean()}),
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
  // Queries from channel_stats as the base table so we can orderBy the
  // authoritative lastActivityAt field (channels.lastActivityAt is deprecated).
  // Supports bidirectional pagination: forward (older items) and backward (newer items).
  dmChannelsLatestMessagesPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ lastActivityAt: z.number(), channelId: z.string() }).nullable(),
      direction: z.enum(['forward', 'backward']).optional(),
    }),
    ({ args: { limit, start, direction } }) => {
      const isBackward = direction === 'backward';

      // For backward: order ASC to get items before cursor, then reverse
      // For forward: order DESC to get items after cursor
      let query = zql.channel_stats
        .whereExists('channel', ch =>
          ch.where(helpers =>
            helpers.or(
              helpers.cmp('scopeType', '=', ChannelScopeType.DM),
              helpers.cmp('scopeType', '=', ChannelScopeType.GROUP_DM),
            ),
          ),
        )
        .orderBy('lastActivityAt', isBackward ? 'asc' : 'desc')
        .orderBy('channelId', isBackward ? 'asc' : 'desc');

      if (start) {
        // Forward: inclusive to include cursor and items after (older)
        // Backward: exclusive to get items before cursor (newer)
        query = query.start(
          { lastActivityAt: start.lastActivityAt, channelId: start.channelId },
          { inclusive: !isBackward },
        );
      }

      return query
        .limit(limit)
        .related('channel', channelQuery =>
          channelQuery.related('conversations', conversationQuery =>
            conversationQuery.orderBy('createdAt', 'desc').limit(1),
          ),
        );
    },
  ),
  conversationOfUserChannels: defineQuery(({ ctx }) => {
    return zql.channels
      .where(helpers => {
        return helpers.exists('participantsStatus', p => {
          return p.where('isClosed', false).where('isDeleted', false).where('userId', ctx.userID);
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
  // Full board detail for editing - includes prStatusMappings for stage PR status config.
  // Used by ProjectDetailScreen when editing a board.
  boardFullDetailById: defineQuery(z.object({ boardId: z.string() }), ({ args: { boardId } }) => {
    return zql.boards
      .where('id', boardId)
      .related('stages', stagesQuery =>
        stagesQuery
          .orderBy('sequenceNumber', 'asc')
          .related('approvers')
          .related('prStatusMappings')
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
  getAllForms: defineQuery(() => {
    return zql.forms
      .related('formFields')
      .related('formContextMappings')
      .orderBy('createdAt', 'desc');
  }),
  // Lightweight forms query - only scalar fields (id, formName, etc.), no related data
  getAllFormsList: defineQuery(() => {
    return zql.forms.orderBy('createdAt', 'desc');
  }),
  // Query for form fields by form ID
  // Order by sequenceNumber first; fall back to createdAt for rows where all sequenceNumbers are 0 (e.g. legacy data before backfill)
  getFormFieldsByFormId: defineQuery(z.object({ formId: z.string() }), ({ args: { formId } }) => {
    return zql.form_fields.where('formId', formId).orderBy('sequenceNumber', 'asc').orderBy('createdAt', 'asc');
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
    z.object({ contextType: z.nativeEnum(FormContextType) }),
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
    return zql.tickets
      .where('ticketType', BaseTicketType.Release)
      .where('isArchived', false)
      .orderBy('createdAt', 'desc');
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
        .where(helpers =>
          helpers.and(
            helpers.cmp('ticketType', '!=', BaseTicketType.Release),
            helpers.cmp('ticketType', '!=', BaseTicketType.Support),
          ),
        )
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

  // Apps Queries
  getAllAppsPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ createdAt: z.number(), id: z.string() }).nullable(),
    }),
    ({ args: { limit, start } }) => {
      let query = zql.apps.orderBy('createdAt', 'desc').orderBy('id', 'desc');
      if (start) {
        query = query.start({ createdAt: start.createdAt, id: start.id }, { inclusive: false });
      }
      return query.limit(limit).related('installations');
    },
  ),

  // Recap Queries
  projectRecaps: defineQuery(
    z.object({
      recapDate: z.number(),
    }),
    ({ ctx, args: { recapDate } }) => {
      return zql.recaps
        .where('recapDate', recapDate)
        .where('entityType', RecapEntityType.PROJECT)
        .where('userId', '=', ctx.userID);
    },
  ),

  channelRecaps: defineQuery(
    z.object({
      channelIds: z.array(z.string()),
      recapDate: z.number(),
    }),
    ({ ctx, args: { channelIds, recapDate } }) => {
      if (channelIds.length === 0) {
        return zql.recaps.limit(0);
      }

      return (
        zql.recaps
          .where('recapDate', recapDate)
          .where('entityType', RecapEntityType.CHANNEL)
          .where(helpers => helpers.or(...channelIds.map(id => helpers.cmp('entityId', id))))
          // Fetch both base recaps (userId IS NULL) and this user's custom recaps
          .where(helpers =>
            helpers.or(helpers.cmp('userId', 'IS', null), helpers.cmp('userId', '=', ctx.userID)),
          )
      );
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
  // Saved Views queries
  savedConfigsByBoard: defineQuery(z.object({ boardId: z.string() }), ({ args: { boardId } }) => {
    return zql.saved_user_configurations
      .where('contextType', SavedConfigContextType.BOARD)
      .where('contextId', boardId)
      .related('values')
      .orderBy('createdAt', 'desc');
  }),

  getWorkspaceById: defineQuery(
    z.object({ workspaceId: z.string() }),
    ({ args: { workspaceId } }) => {
      return zql.workspaces.where('id', workspaceId).one();
    },
  ),

  // Get organizations linked to workspace
  workspaceOrganizations: defineQuery(
    z.object({ workspaceId: z.string() }),
    ({ args: { workspaceId } }) => {
      return zql.workspace_organizations
        .where('workspaceId', workspaceId)
        .where('leftAt', 'IS', null)
        .related('organization')
        .orderBy('createdAt', 'desc');
    },
  ),

  // Get all ACTIVE organizations
  availableOrganizations: defineQuery(z.object({}), () => {
    return zql.organizations.where('status', Status.ACTIVE).orderBy('name', 'asc');
  }),

  // Get active members of an organisation
  getOrgMembers: defineQuery(z.object({ orgId: z.string() }), ({ args: { orgId } }) => {
    return zql.org_members
      .where('orgId', orgId)
      .where('leftAt', 'IS', null)
      .orderBy('joinedAt', 'asc');
  }),

  getOrgMemberById: defineQuery(z.object({ memberId: z.string() }), ({ args: { memberId } }) => {
    return zql.org_members.where('memberId', memberId).one();
  }),

  // Get all workspace invitations (filtered client-side by workspaceId)
  getAllInvitations: defineQuery(z.object({}), () => {
    return zql.invitations.orderBy('createdAt', 'desc');
  }),


  // ── Sent Messages ─────────────────────────────────────────────────────────
  /** Paginated messages sent by the current user, ordered newest first */
  userSentMessagesPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ messageId: z.string(), createdAt: z.number() }).nullable(),
    }),
    ({ ctx, args: { limit, start } }) => {
      let query = zql.messages
        .where('senderId', ctx.userID)
        .where('isDeleted', false)
        .orderBy('createdAt', 'desc')
        .orderBy('messageId', 'desc');

      if (start) {
        query = query.start(
          { messageId: start.messageId, createdAt: start.createdAt },
          { inclusive: false },
        );
      }

      return query.limit(limit).related('attachments').related('conversation');
    },
  ),

  // ── Scheduled Messages ────────────────────────────────────────────────────
  /** All scheduled messages for the current user that are still pending */
  userDelayedMessages: defineQuery(({ ctx }) => {
    return zql.delayed_messages
      .where('senderId', ctx.userID)
      .where('status', DelayedMessageStatus.PENDING)
      .orderBy('scheduledFor', 'asc')
      .related('attachments');
  }),

  /** Paginated scheduled messages for the current user */
  userDelayedMessagesPaginated: defineQuery(
    z.object({
      limit: z.number(),
      statuses: z.array(z.string()).optional(),
      start: z.object({ id: z.string(), scheduledFor: z.number() }).nullable(),
    }),
    ({ ctx, args: { limit, statuses, start } }) => {
      const effectiveStatuses =
        statuses && statuses.length > 0
          ? (statuses as DelayedMessageStatus[])
          : [DelayedMessageStatus.PENDING];

      let query = zql.delayed_messages
        .where('senderId', ctx.userID)
        .orderBy('scheduledFor', 'asc')
        .orderBy('id', 'asc');

      if (effectiveStatuses.length === 1 && effectiveStatuses[0]) {
        query = query.where('status', effectiveStatuses[0]);
      } else {
        query = query.where(h =>
          h.or(...effectiveStatuses.map(s => h.cmp('status', '=', s))),
        );
      }

      if (start) {
        query = query.start(
          { id: start.id, scheduledFor: start.scheduledFor },
          { inclusive: false },
        );
      }

      return query.limit(limit).related('attachments');
    },
  ),
});
