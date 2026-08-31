import { createBuilder, defineQueries } from '@rocicorp/zero';
import { BaseTicketType } from './types.js';
import { flowStepVisibilitySchemaShape } from '../tickets/flow.js';
import { defineQuery } from './acl/define-query.js';
import {
  AccessType,
  BoardType,
  CallType,
  EntityUserAccess,
  FormContextType,
  FormEntityType,
  LookupType,
  ProjectType,
  SavedConfigContextType,
  ShareableEntityType,
  SummaryTemplateVisibility,
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
  EmailType,
  schema,
  LinkVisibility,
  NudgeState,
  Status,
  TicketPriority,
  TicketStageRequestStatus,
  MailboxState,
  MessageArtifactStatus,
  TicketStatusV2,
  TicketReferenceRelation,
  DelayedMessageStatus,
  RecapEntityType,
  UserResponsibility,
  UserType,
} from './schema.js';

export const zql = createBuilder(schema);

const kanbanTicketPageFiltersSchema = z.object({
  priority: z.array(z.nativeEnum(TicketPriority)).optional(),
  assignee: z.array(z.string()).optional(),
  userGroups: z.array(z.string()).optional(),
  createdBy: z.array(z.string()).optional(),
  prReviewers: z.array(z.string()).optional(),
  qaAssigned: z.array(z.string()).optional(),
  dueDateStart: z.number().optional(),
  dueDateEnd: z.number().optional(),
  createdDateStart: z.number().optional(),
  createdDateEnd: z.number().optional(),
  boards: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  assigned: z.boolean().optional(),
  created: z.boolean().optional(),
  stages: z.array(z.string()).optional(),
  ticketTypes: z.array(z.string()).optional(),
  sourceChannels: z.array(z.string()).optional(),
});

const kanbanTicketsPageArgsSchema = z.object({
  viewMode: z.enum(['project', 'board', 'my-tickets', 'user-tickets', 'group-tickets']),
  channelId: z.string().optional(),
  projectId: z.string().optional(),
  boardId: z.string().optional(),
  userId: z.string().optional(),
  groupId: z.string().optional(),
  ...flowStepVisibilitySchemaShape,
  columnType: z.enum(['stage', 'status']).optional(),
  stageName: z.string(),
  limit: z.number(),
  start: z
    .object({
      createdAt: z.number(),
      id: z.string(),
    })
    .nullable(),
  groupBy: z
    .union([
      z.enum(['none', 'assignee', 'status', 'priority']),
      z.object({
        type: z.literal('formField'),
        fieldId: z.string(),
        fieldName: z.string().optional(),
        fieldType: z.string().optional(),
      }),
    ])
    .optional(),
  groupKey: z.string().optional(),
  formFieldValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  vespaTicketIds: z.array(z.string()).optional(),
  dynamicFieldScalarFilters: z
    .array(z.object({
      fieldId: z.string(),
      values: z.array(z.union([z.string(), z.number(), z.boolean()])),
    }))
    .optional(),
  filters: kanbanTicketPageFiltersSchema.optional(),
  formEntityValueFieldIds: z.array(z.string()).optional(),
});

type KanbanTicketsPageArgs = z.infer<typeof kanbanTicketsPageArgsSchema>;

const kanbanTicketPageV2FiltersSchema = kanbanTicketPageFiltersSchema.extend({
  roleAssignments: z
    .array(z.object({ roleId: z.string(), userIds: z.array(z.string()) }))
    .optional(),
});

const kanbanTicketsPageV3ArgsSchema = kanbanTicketsPageArgsSchema.extend({
  filters: kanbanTicketPageV2FiltersSchema.optional(),
  dir: z.literal('forward').or(z.literal('backward')).optional(),
  showOverdueOnly: z.boolean().optional(),
  overdueReferenceTime: z.number().optional(),
});

type KanbanTicketsPageV3Args = z.infer<typeof kanbanTicketsPageV3ArgsSchema>;

const prefixedKanbanIdentityValues = (id: string): string[] => [
  id,
  `user:${id}`,
  `group:${id}`,
  `userGroup:${id}`,
];

// Sentinel value in the assignee filter meaning "tickets with no assignee".
export const UNASSIGNED_FILTER_VALUE = 'unassigned';

// Marker entry in the assignee filter meaning "exclude the selected assignees
// instead of matching them". It lives inside the ids array so it survives every
// transport (query args, saved views, counts requests) without schema changes.
export const ASSIGNEE_INVERT_MARKER = '!invert';

export interface ParsedAssigneeFilter {
  inverted: boolean;
  includeUnassigned: boolean;
  ids: string[];
}

export const parseAssigneeFilter = (values: readonly string[]): ParsedAssigneeFilter => {
  const inverted = values.includes(ASSIGNEE_INVERT_MARKER);
  const rest = values.filter(value => value !== ASSIGNEE_INVERT_MARKER);
  return {
    inverted,
    includeUnassigned: rest.includes(UNASSIGNED_FILTER_VALUE),
    ids: rest.filter(value => value !== UNASSIGNED_FILTER_VALUE),
  };
};

const toActualFieldValueQueryValue = (
  value: string | number | boolean,
): string | number | boolean =>
  typeof value === 'string' ? JSON.stringify(value) : value;

const supportDynamicFieldFiltersSchema = z
  .array(
    z.object({
      fieldId: z.string(),
      values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
  )
  .optional();

type SupportDynamicFieldFilters = z.infer<typeof supportDynamicFieldFiltersSchema>;

const applySupportDynamicFieldFilters = (
  query: any,
  dynamicFieldFilters: SupportDynamicFieldFilters,
) => {
  if (!dynamicFieldFilters?.length) return query;
  for (const fieldFilter of dynamicFieldFilters) {
    const { fieldId, values } = fieldFilter;
    query = query.whereExists('formEntityValues', (formEntityValue: any) => {
      let fevQuery = formEntityValue.where('entityType', 'TICKET').where('fieldId', fieldId);
      if (values && values.length > 0) {
        fevQuery = fevQuery.where((helpers: any) =>
          helpers.or(
            ...values.map((value: string | number | boolean) =>
              helpers.cmp('actualFieldValue', '=', toActualFieldValueQueryValue(value)),
            ),
          ),
        );
      }
      return fevQuery;
    });
  }
  return query;
};

const relateSupportDynamicFieldValues = (
  fev: any,
  dynamicFieldFilters: SupportDynamicFieldFilters,
  formEntityValueFieldIds?: string[],
) => {
  const fieldIds = [
    ...new Set([
      ...(dynamicFieldFilters ?? []).map(fieldFilter => fieldFilter.fieldId),
      ...(formEntityValueFieldIds ?? []),
    ]),
  ];
  return fieldIds.length > 0
    ? fev.where('entityType', 'TICKET').where('fieldId', 'IN', fieldIds)
    : fev.where('fieldId', '__no_dynamic_field_filters__');
};

const applyKanbanTicketPageConditions = (
  query: any,
  ctx: { userID: string },
  args: KanbanTicketsPageArgs,
) => {
  const {
    viewMode,
    channelId,
    projectId,
    boardId,
    userId,
    groupId,
    columnType,
    stageName,
    groupBy,
    groupKey,
    formFieldValue,
    vespaTicketIds,
    dynamicFieldScalarFilters,
    filters,
  } = args;

  if (stageName) {
    query =
      columnType === 'status'
        ? query.where('statusV2', stageName as TicketStatusV2)
        : query.where('stageName', stageName);
  }

  query = query.where('isArchived', false);

  if (channelId) {
    query = query.where('channelId', channelId);
  }

  if (stageName && columnType !== 'status' && filters?.stages?.length && !filters.stages.includes(stageName)) {
    return query.where('id', '__kanban_stage_filter_no_match__');
  }

  if (filters?.stages?.length) {
    query = query.where('stageName', 'IN', filters.stages);
  }

  if (boardId) {
    query = query.where('boardId', boardId);
  }

  if (!boardId && viewMode !== 'my-tickets' && projectId) {
    query = query.where('projectId', projectId);
  }

  // Scope by selected boards server-side so multi-board pagination stays correct.
  if (!boardId && filters?.boards?.length) {
    query = query.where('boardId', 'IN', filters.boards);
  }

  if (args.excludeFlowSteps) {
    query = query.where('rootId', 'IS', null);
  }

  switch (viewMode) {
    case 'my-tickets':
      query = query.where((helpers: any) =>
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
        query = query.where((helpers: any) =>
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
        query = query.where((helpers: any) =>
          helpers.or(
            helpers.cmp('userGroupId', `group:${groupId}`),
            helpers.cmp('userGroupId', groupId),
          ),
        );
      }
      break;
  }

  query = query.where((helpers: any) =>
    helpers.or(
      helpers.cmp('ticketType', 'IS', null),
      helpers.cmp('ticketType', '!=', BaseTicketType.Support),
    ),
  );

  if (filters?.priority?.length) {
    query = query.where('priority', 'IN', filters.priority);
  }

  if (filters?.assignee?.length) {
    const { inverted, includeUnassigned, ids } = parseAssigneeFilter(filters.assignee);
    const prefixedIds = ids.flatMap(prefixedKanbanIdentityValues);
    if (prefixedIds.length || includeUnassigned) {
      if (!inverted) {
        query = query.where((helpers: any) =>
          helpers.or(
            ...(prefixedIds.length ? [helpers.cmp('assignedTo', 'IN', prefixedIds)] : []),
            ...(includeUnassigned
              ? [helpers.cmp('assignedTo', 'IS', null), helpers.cmp('assignedTo', '')]
              : []),
          ),
        );
      } else if (includeUnassigned) {
        // Complement including "unassigned": the ticket must be assigned to
        // someone outside the selected set.
        query = query.where((helpers: any) =>
          helpers.and(
            ...(prefixedIds.length ? [helpers.cmp('assignedTo', 'NOT IN', prefixedIds)] : []),
            helpers.cmp('assignedTo', 'IS NOT', null),
            helpers.cmp('assignedTo', '!=', ''),
          ),
        );
      } else {
        // Complement of the selected users — unassigned tickets qualify too
        // (NOT IN drops NULL rows, so include them explicitly).
        query = query.where((helpers: any) =>
          helpers.or(
            helpers.cmp('assignedTo', 'NOT IN', prefixedIds),
            helpers.cmp('assignedTo', 'IS', null),
            helpers.cmp('assignedTo', ''),
          ),
        );
      }
    }
  }

  if (filters?.createdBy?.length) {
    query = query.where('createdBy', 'IN', filters.createdBy);
  }

  if (filters?.userGroups?.length) {
    query = query.where('userGroupId', 'IN', filters.userGroups);
  }

  if (filters?.tags?.length) {
    query = query.whereExists('tagMappings', (tagMapping: any) =>
      tagMapping.where('tagName', 'IN', filters.tags),
    );
  }

  if (filters?.prReviewers?.length) {
    query = query.whereExists('assignments', (assignment: any) =>
      assignment
        .where('userResponsibility', UserResponsibility.PR_REVIEWER)
        .where('userId', 'IN', filters.prReviewers ?? []),
    );
  }

  if (filters?.qaAssigned?.length) {
    query = query.whereExists('assignments', (assignment: any) =>
      assignment
        .where('userResponsibility', UserResponsibility.QA)
        .where('userId', 'IN', filters.qaAssigned ?? []),
    );
  }

  if (filters?.dueDateStart !== undefined) {
    query = query.where('eta', '>=', filters.dueDateStart);
  }

  if (filters?.dueDateEnd !== undefined) {
    query = query.where('eta', '<=', filters.dueDateEnd);
  }

  if (filters?.createdDateStart !== undefined) {
    query = query.where('createdAt', '>=', filters.createdDateStart);
  }

  if (filters?.createdDateEnd !== undefined) {
    query = query.where('createdAt', '<=', filters.createdDateEnd);
  }

  if (filters?.ticketTypes?.length) {
    query = query.where('ticketType', 'IN', filters.ticketTypes);
  }

  if (filters?.sourceChannels?.length) {
    query = query.where('channelId', 'IN', filters.sourceChannels);
  }

  if (filters?.assigned || filters?.created) {
    query = query.where((helpers: any) => {
      const assignedToMe = helpers.or(
        helpers.cmp('assignedTo', `user:${ctx.userID}`),
        helpers.cmp('assignedTo', ctx.userID),
      );
      const createdByMe = helpers.or(
        helpers.cmp('createdBy', `user:${ctx.userID}`),
        helpers.cmp('createdBy', ctx.userID),
      );

      if (filters.assigned && filters.created) {
        return helpers.or(assignedToMe, createdByMe);
      }

      return filters.assigned ? assignedToMe : createdByMe;
    });
  }

  if (vespaTicketIds) {
    if (vespaTicketIds.length === 0) {
      return query.where('id', '__kanban_vespa_no_match__');
    }
    query = query.where('id', 'IN', vespaTicketIds);
  }

  if (dynamicFieldScalarFilters?.length) {
    for (const dynamicFieldFilter of dynamicFieldScalarFilters) {
      if (dynamicFieldFilter.values.length === 0) continue;

      query = query.whereExists('formEntityValues', (formEntityValue: any) =>
        formEntityValue
          .where('entityType', 'TICKET')
          .where('fieldId', dynamicFieldFilter.fieldId)
          .where((helpers: any) =>
            helpers.or(
              ...dynamicFieldFilter.values.map((value: string | number | boolean) =>
                helpers.cmp('actualFieldValue', '=', toActualFieldValueQueryValue(value)),
              ),
            ),
          ),
      );
    }
  }

  if (groupBy === 'assignee' && groupKey) {
    query =
      groupKey === 'Unassigned'
        ? query.where('assignedTo', 'IS', null)
        : query.where('assignedTo', groupKey);
  } else if (groupBy === 'status' && groupKey) {
    query = query.where('statusV2', groupKey as TicketStatusV2);
  } else if (groupBy === 'priority' && groupKey) {
    query = query.where('priority', groupKey as TicketPriority);
  } else if (typeof groupBy === 'object' && groupBy.type === 'formField' && formFieldValue !== undefined) {
    query = query.whereExists('formEntityValues', (formEntityValue: any) =>
      formEntityValue
        .where('entityType', 'TICKET')
        .where('fieldId', groupBy.fieldId)
        .where('actualFieldValue', '=', toActualFieldValueQueryValue(formFieldValue)),
    );
  }

  return query;
};

const applyKanbanTicketPageV3Conditions = (
  query: any,
  ctx: { userID: string },
  args: KanbanTicketsPageV3Args,
) => {
  query = applyKanbanTicketPageConditions(query, ctx, args);

  if (args.filters?.roleAssignments?.length) {
    for (const roleAssignment of args.filters.roleAssignments) {
      if (!roleAssignment.userIds.length) continue;
      query = query.whereExists('assignments', (assignment: any) =>
        assignment.where('roleId', roleAssignment.roleId).where('userId', 'IN', roleAssignment.userIds),
      );
    }
  }

  if (args.showOverdueOnly) {
    query = query.where((helpers: any) =>
      helpers.and(
        helpers.cmp('statusV2', '!=', TicketStatusV2.COMPLETED),
        helpers.cmp('statusV2', '!=', TicketStatusV2.CANCELLED),
        helpers.cmp('isStageOverdue', true),
      ),
    );
  }

  return query;
};

const applyCanvasVisibilityQueryFilter = (
  query: any,
  userId: string,
  includePublicVisibility = true,
) =>
  query.where((helpers: any) =>
    helpers.or(
      helpers.cmp('createdBy', userId),
      helpers.exists('participants', (p: any) =>
        p.where(({ or, cmp, exists: ex }: any) =>
          or(
            cmp('userId', userId),
            ex('userGroup', (ug: any) =>
              ug.whereExists('userGroupMappings', (m: any) => m.where('userId', userId)),
            ),
            ex('channel', (ch: any) =>
              ch.whereExists('participants', (cp: any) => cp.where('userId', userId)),
            ),
          ),
        ),
      ),
      ...(includePublicVisibility ? [helpers.cmp('visibility', CanvasVisibility.PUBLIC)] : []),
    ),
  );

const includeCurrentUserCanvasStatus = (query: any, userId: string) =>
  query.related('userStatuses', (status: any) => status.where('userId', userId));

// Keep in sync with the identical helper in apps/backend/src/zero/queries.ts if archive-filter behavior changes.
const applyArchiveFilter = <T extends { where: Function }>(
  query: T,
  { includeArchived, onlyArchived }: { includeArchived?: boolean; onlyArchived?: boolean },
): T => {
  if (onlyArchived) return query.where('isArchived', true);
  if (!includeArchived) return query.where('isArchived', false);
  return query;
};


export const queries = defineQueries({
  activeSlashCommandArtifacts: defineQuery(({ ctx }) =>
    zql.message_artifacts
      .where('workspaceId', ctx.workspaceId)
      .where('status', MessageArtifactStatus.ACTIVE)
      // Banner delivery is participant-only even when public channel messages are readable.
      .whereExists('channelParticipants', participant =>
        participant.where('userId', ctx.userID),
      )
      .orderBy('messageCreatedAt', 'desc'),
  ),

  userChannelSections: defineQuery(z.object({}), () => {
    return zql.channel_sections.where('isDeleted', false).orderBy('position', 'asc');
  }),
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

  messagesByIds: defineQuery(
    z.object({ messageIds: z.array(z.string()) }),
    ({ ctx, args: { messageIds } }) => {
      return zql.messages
        .where(helpers => helpers.cmp('messageId', 'IN', messageIds))
        .where(helpers =>
          helpers.or(
            helpers.cmp('visibleTo', 'IS', null),
            helpers.cmp('visibleTo', '=', ctx.userID),
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
    z.object({
      conversationId: z.string(),
      channelId: z.string(),
      isMember: z.boolean(),
    }),
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


  // Enriched single query for thread panel.
  threadConversationV2: defineQuery(
    z.object({
      conversationId: z.string(),
      channelId: z.string().optional(),
      isMember: z.boolean().optional(),
    }),
    ({ ctx, args: { conversationId } }) => {
      return zql.conversations
        .where('conversationId', conversationId)
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
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      timestamp: z.number(),
    }),
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
  // V2: includes .related('tagMappings') for per-ticket tag display from new data model
  ticketsQueryV2: defineQuery(
    z.object({
      viewMode: z.enum(['project', 'board', 'my-tickets', 'user-tickets', 'group-tickets']),
      channelId: z.string().optional(),
      projectId: z.string().optional(),
      boardId: z.string().optional(),
      userId: z.string().optional(),
      groupId: z.string().optional(),
      ...flowStepVisibilitySchemaShape,
      formEntityValueFieldIds: z.array(z.string()).optional(),
    }),
    ({
      ctx,
      args: {
        viewMode,
        channelId,
        projectId,
        boardId,
        userId,
        groupId,
        excludeFlowSteps,
        formEntityValueFieldIds,
      },
    }) => {
      let query = zql.tickets;

      if (channelId) {
        query = query.where('channelId', channelId);
      }

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

      if (excludeFlowSteps) {
        query = query.where('rootId', 'IS', null);
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
        .related('assignments', a => a.related('role'))
        .related('stageEtaEntries')
        .related('tagMappings');

      // Conditionally add formEntityValues related query when fieldIds are provided
      // All dynamic field filtering is done client-side via applyTicketFilters
      if (formEntityValueFieldIds && formEntityValueFieldIds.length > 0) {
        finalQuery = finalQuery.related('formEntityValues', fev =>
          fev.where('fieldId', 'IN', formEntityValueFieldIds).related('formField').related('globalField'),
        );
      }

      return finalQuery;
    },
  ),

  kanbanTicketsPage: defineQuery(
    kanbanTicketsPageArgsSchema,
    ({ ctx, args }) => {
      let query = applyKanbanTicketPageConditions(zql.tickets, ctx, args)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'asc');

      if (args.start) {
        query = query.start({ createdAt: args.start.createdAt, id: args.start.id }, { inclusive: false });
      }

      let finalQuery = query
        .limit(args.limit)
        .related('assignments')
        .related('stageEtaEntries')
        .related('tagMappings');

      if (args.formEntityValueFieldIds?.length) {
        finalQuery = finalQuery.related('formEntityValues', (fev: any) =>
          fev.where('fieldId', 'IN', args.formEntityValueFieldIds ?? []).related('formField').related('globalField'),
        );
      }

      return finalQuery;
    },
  ),

  kanbanTicketsPageV3: defineQuery(
    kanbanTicketsPageV3ArgsSchema,
    ({ ctx, args }) => {
      const dir = args.dir ?? 'forward';
      let query = applyKanbanTicketPageV3Conditions(zql.tickets, ctx, args)
        .orderBy('createdAt', dir === 'forward' ? 'desc' : 'asc')
        .orderBy('id', dir === 'forward' ? 'asc' : 'desc');

      if (args.start) {
        query = query.start({ createdAt: args.start.createdAt, id: args.start.id }, { inclusive: false });
      }

      let finalQuery = query
        .limit(args.limit)
        .related('assignments', (a: any) => a.related('role'))
        .related('tagMappings');

      if (args.formEntityValueFieldIds?.length) {
        finalQuery = finalQuery.related('formEntityValues', (fev: any) =>
          fev.where('fieldId', 'IN', args.formEntityValueFieldIds ?? []).related('formField').related('globalField'),
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
      // Exclude automation rows — they live on the same `workflows` table
      // (workflowType='Automations') but have their own builder UI / run
      // history. Use an OR-with-IS-NULL because `!= 'Automations'` alone
      // would also exclude legacy rows with `workflowType = NULL`.
      let query = zql.workflows.where(helpers =>
        helpers.or(
          helpers.cmp('workflowType', 'IS', null),
          helpers.cmp('workflowType', '!=', 'Automations'),
        ),
      );

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
  ticketsForEmailChannelsV2: defineQuery(() => {
    return zql.tickets
      .whereExists('conversation', conversation =>
        conversation.whereExists('channel', channel => channel.where('type', ChannelType.EMAIL)),
      )
      .orderBy('createdAt', 'desc')
      .related('project')
      .related('tagMappings')
      .related('entity')
      .related('conversation');
  }),
  // Unified query for Xyne Desk: tickets scoped to a single channel.
  // channelId + isMember are required and forwarded to TicketsACL for membership gating.
  supportTicketsFilteredV3: defineQuery(
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      merchantMid: z.string().optional(),
      assignedTo: z.array(z.string()).optional(),
      createdBy: z.array(z.string()).optional(),
      priority: z.array(z.nativeEnum(TicketPriority)).optional(),
      stageName: z.array(z.string()).optional(),
      aiCategory: z.array(z.string()).optional(),
      conversationIds: z.array(z.string()).optional(),
      hasAiDraft: z.boolean().optional(),
      userGroups: z.array(z.string()).optional(),
      lastEmailAtStart: z.number().optional(),
      lastEmailAtEnd: z.number().optional(),
      createdAtStart: z.number().optional(),
      createdAtEnd: z.number().optional(),
      conversationLabelId: z.string().optional(),
      dynamicFieldFilters: supportDynamicFieldFiltersSchema,
      formEntityValueFieldIds: z.array(z.string()).optional(),
    }).refine(
      args => args.createdAtStart === undefined || args.createdAtEnd === undefined || args.createdAtStart <= args.createdAtEnd,
      'createdAtStart must be less than or equal to createdAtEnd',
    ),
    ({ ctx, args: { channelId, merchantMid, assignedTo, createdBy, priority, stageName, aiCategory, conversationIds, hasAiDraft, userGroups, lastEmailAtStart, lastEmailAtEnd, createdAtStart, createdAtEnd, conversationLabelId, dynamicFieldFilters, formEntityValueFieldIds } }) => {
      let query = zql.tickets.where('channelId', channelId);
      query = query.where('isArchived', false);

      if (merchantMid) {
        query = query.where('merchantId', merchantMid);
      }

      if (assignedTo && assignedTo.length > 0) {
        query = query.where(({ or, cmp }) => or(...assignedTo.map((id) => cmp('assignedTo', id))));
      }

      if (createdBy && createdBy.length > 0) {
        query = query.where('createdBy', 'IN', createdBy);
      }

      if (priority && priority.length > 0) {
        query = query.where(({ or, cmp }) => or(...priority.map((p) => cmp('priority', p))));
      }

      if (stageName && stageName.length > 0) {
        query = query.where(({ or, cmp }) => or(...stageName.map((s) => cmp('stageName', s))));
      }

      if (aiCategory && aiCategory.length > 0) {
        query = query.where(({ or, cmp }) => or(...aiCategory.map((c) => cmp('aiCategory', c))));
      }

      if (conversationIds !== undefined) {
        query = query.where('conversationId', 'IN', conversationIds.length > 0 ? conversationIds : ['']);
      }

      if (hasAiDraft) {
        query = query.where(({ exists }) =>
          exists('emailDrafts', (draft) => draft.where('userId', 'IS', null)),
        );
      }

      if (userGroups && userGroups.length > 0) {
        query = query.where('userGroupId', 'IN', userGroups);
      }
      if (conversationLabelId) {
        query = query.where(({ exists }) =>
          exists('conversationLabelMappings', (m) => m.where('labelId', conversationLabelId)),
        );
      }

      if (lastEmailAtStart !== undefined) {
        query = query.where('lastEmailAt', '>=', lastEmailAtStart);
      }

      if (lastEmailAtEnd !== undefined) {
        query = query.where('lastEmailAt', '<=', lastEmailAtEnd);
      }

      if (createdAtStart !== undefined) {
        query = query.where('createdAt', '>=', createdAtStart);
      }

      if (createdAtEnd !== undefined) {
        query = query.where('createdAt', '<=', createdAtEnd);
      }

      query = applySupportDynamicFieldFilters(query, dynamicFieldFilters);

      return query
        .orderBy('createdAt', 'desc')
        .related('project')
        .related('tagMappings')
        .related('entity')
        .related('conversation', c => c.related('channel'))
        .related('emailReads', q => q.where('userId', ctx.userID))
        .related('formEntityValues', fev =>
          relateSupportDynamicFieldValues(fev, dynamicFieldFilters, formEntityValueFieldIds),
        );
    },
  ),
  // Single-row variant matching supportTicketsPage row shape (for @rocicorp/zero-virtual permalinks).
  // channelId + isMember are forwarded to TicketsACL for membership gating.
  // emailDrafts is scoped to the current user (drafts are per-user private).
  supportTicketRowV3: defineQuery(
    z.object({ id: z.string(), channelId: z.string(), isMember: z.boolean() }),
    ({ ctx, args: { id } }) => {
      return zql.tickets
        .where('id', id)
        .related('project')
        .related('tagMappings')
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
  supportTicketByXyneIdV4: defineQuery(
    z.object({ xyneId: z.string(), workspaceId: z.string(), channelId: z.string(), isMember: z.boolean() }),
    ({ ctx, args: { xyneId, workspaceId } }) => {
      return zql.tickets
        .where('xyneId', xyneId)
        .where('workspaceId', workspaceId)
        .related('project')
        .related('tagMappings')
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

  supportTicketDetail: defineQuery(
    z.object({
      id: z.string().optional(),
      xyneId: z.string().optional(),
      workspaceId: z.string(),
      channelId: z.string(),
      isMember: z.boolean(),
    }),
    ({ ctx, args: { id, xyneId, workspaceId } }) => {
      const base = id
        ? zql.tickets.where('id', id)
        : zql.tickets.where('xyneId', xyneId ?? '').where('workspaceId', workspaceId);
      return base
        .related('referencesIn', ref =>
          ref.where('relationType', TicketReferenceRelation.MERGED_INTO)
            .related('sourceTicket'),
        )
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

  supportTicketDetailV2: defineQuery(
    z.object({
      id: z.string().optional(),
      xyneId: z.string().optional(),
      workspaceId: z.string(),
      channelId: z.string(),
      isMember: z.boolean(),
    }),
    ({ args: { id, xyneId, workspaceId } }) => {
      const base = id
        ? zql.tickets.where('id', id)
        : zql.tickets.where('xyneId', xyneId ?? '').where('workspaceId', workspaceId);
      return base
        .related('referencesIn', ref =>
          ref.where('relationType', TicketReferenceRelation.MERGED_INTO)
            .related('sourceTicket'),
        )
        .one();
    },
  ),
  // Paginated variant of supportTicketsFiltered for use with @rocicorp/zero-virtual.
  // Cursor = (lastEmailAt, id) matching the orderBy. Active threads bubble up.
  // channelId + isMember are forwarded to TicketsACL for membership gating.
  supportTicketsPageV3: defineQuery(
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      assignedTo: z.array(z.string()).optional(),
      createdBy: z.array(z.string()).optional(),
      priority: z.array(z.nativeEnum(TicketPriority)).optional(),
      stageName: z.array(z.string()).optional(),
      aiCategory: z.array(z.string()).optional(),
      conversationIds: z.array(z.string()).optional(),
      hasAiDraft: z.boolean().optional(),
      mailboxFolder: z.enum(['inbox', 'all', 'starred', 'spam', 'sent', 'drafts']).optional(),
      userGroups: z.array(z.string()).optional(),
      lastEmailAtStart: z.number().optional(),
      lastEmailAtEnd: z.number().optional(),
      createdAtStart: z.number().optional(),
      createdAtEnd: z.number().optional(),
      conversationLabelId: z.string().optional(),
      dynamicFieldFilters: supportDynamicFieldFiltersSchema,
      limit: z.number(),
      start: z.object({ id: z.string(), lastEmailAt: z.number() }).nullable(),
      dir: z.literal('forward').or(z.literal('backward')),
    }).refine(
      args => args.createdAtStart === undefined || args.createdAtEnd === undefined || args.createdAtStart <= args.createdAtEnd,
      'createdAtStart must be less than or equal to createdAtEnd',
    ),
    ({ ctx, args: { channelId, assignedTo, createdBy, priority, stageName, aiCategory, conversationIds, hasAiDraft, mailboxFolder, userGroups, lastEmailAtStart, lastEmailAtEnd, createdAtStart, createdAtEnd, conversationLabelId, dynamicFieldFilters, limit, start, dir } }) => {
      let query = zql.tickets.where('channelId', channelId);
      query = query.where('isArchived', false);

      if (assignedTo && assignedTo.length > 0) {
        query = query.where(({ or, cmp }) => or(...assignedTo.map((id) => cmp('assignedTo', id))));
      }

      if (createdBy && createdBy.length > 0) {
        query = query.where('createdBy', 'IN', createdBy);
      }

      if (priority && priority.length > 0) {
        query = query.where(({ or, cmp }) => or(...priority.map((p) => cmp('priority', p))));
      }

      if (stageName && stageName.length > 0) {
        query = query.where(({ or, cmp }) => or(...stageName.map((s) => cmp('stageName', s))));
      }

      if (aiCategory && aiCategory.length > 0) {
        query = query.where(({ or, cmp }) => or(...aiCategory.map((c) => cmp('aiCategory', c))));
      }

      if (conversationIds !== undefined) {
        query = query.where('conversationId', 'IN', conversationIds.length > 0 ? conversationIds : ['']);
      }

      if (hasAiDraft) {
        query = query.where(({ exists }) =>
          exists('emailDrafts', (draft) => draft.where('userId', 'IS', null)),
        );
      }

      // Mailbox folder server-side filtering. Spam and Starred REQUIRE an overlay row, so they
      // can be filtered with a positive exists() (works on the client too, unlike not(exists)),
      // making pagination meaningful instead of scanning the whole channel client-side. Inbox /
      // All Mail include no-overlay tickets (default = Inbox) and stay client-side.
      if (mailboxFolder === 'spam') {
        query = query.where(({ exists }) =>
          exists('userMailbox', m =>
            m.where('userId', ctx.userID).where('state', MailboxState.SPAM),
          ),
        );
      } else if (mailboxFolder === 'starred') {
        query = query.where(({ exists }) =>
          exists('userMailbox', m =>
            m
              .where('userId', ctx.userID)
              .where('starred', true)
              .where(({ or, cmp }) =>
                or(cmp('state', MailboxState.INBOX), cmp('state', MailboxState.ARCHIVED)),
              ),
          ),
        );
      } else if (mailboxFolder === 'sent') {
        // "Sent" = tickets the current user has sent an outbound email on (REPLY /
        // REPLY_ALL / COMPOSE). A positive exists() runs client-side too, so pagination
        // stays meaningful and the list is one-row-per-ticket (no email-level collapse).
        query = query.where(({ exists }) =>
          exists('emails', e =>
            e
              .where('type', 'IN', [EmailType.REPLY, EmailType.REPLY_ALL, EmailType.COMPOSE])
              .where('sentByUserId', ctx.userID),
          ),
        );
      } else if (mailboxFolder === 'drafts') {
        // "Drafts" = tickets the current user has a saved reply draft on (conversationId
        // set → tied to a ticket). Compose drafts (no conversationId, no ticket yet) are
        // surfaced separately via the Drafts chip banner, not in this list.
        query = query.where(({ exists }) =>
          exists('emailDrafts', d =>
            d.where('userId', ctx.userID).where('conversationId', 'IS NOT', null),
          ),
        );
      }

      if (userGroups && userGroups.length > 0) {
        query = query.where('userGroupId', 'IN', userGroups);
      }
      if (conversationLabelId) {
        query = query.where(({ exists }) =>
          exists('conversationLabelMappings', (m) => m.where('labelId', conversationLabelId)),
        );
      }

      if (lastEmailAtStart !== undefined) {
        query = query.where('lastEmailAt', '>=', lastEmailAtStart);
      }

      if (lastEmailAtEnd !== undefined) {
        query = query.where('lastEmailAt', '<=', lastEmailAtEnd);
      }

      if (createdAtStart !== undefined) {
        query = query.where('createdAt', '>=', createdAtStart);
      }

      if (createdAtEnd !== undefined) {
        query = query.where('createdAt', '<=', createdAtEnd);
      }

      query = applySupportDynamicFieldFilters(query, dynamicFieldFilters);

      const orderDirection = dir === 'forward' ? 'desc' : 'asc';
      query = query.orderBy('lastEmailAt', orderDirection);
      // id tiebreak keeps the (lastEmailAt, id) keyset cursor deterministic on ties.
      query = query.orderBy('id', orderDirection);

      if (start) {
        query = query.start(
          { lastEmailAt: start.lastEmailAt, id: start.id },
          { inclusive: false },
        );
      }

      return (
        query
          .limit(limit)
          .related('emailDrafts', q =>
            q.where(({ or, cmp }) =>
              or(cmp('userId', '=', ctx.userID), cmp('userId', 'IS', null)),
            ),
          )
          .related('emailReads', q => q.where('userId', ctx.userID))
          // Caller's per-user mailbox overlay so the list can be filtered into mailbox
          // folders (Inbox / All Mail / Starred / Spam) client-side. A ticket with no
          // overlay row defaults to Inbox.
          .related('userMailbox', q => q.where('userId', ctx.userID))
          .related('formEntityValues', fev =>
            relateSupportDynamicFieldValues(fev, dynamicFieldFilters),
          )
      );
    },
  ),
  supportTicketsPageV4: defineQuery(
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
      query = query.where('isArchived', false);

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
        .related('tagMappings')
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
  // @deprecated Use getEmailsForConversationsV2 when channel membership is known.
  getEmailsForConversations: defineQuery(
    z.object({ conversationIds: z.array(z.string()) }),
    ({ args: { conversationIds } }) => {
      if (conversationIds.length === 0) {
        return zql.emails
          .where('conversationId', '__no_match__')
          .related('attachments');
      }
      return zql.emails
        .where('conversationId', 'IN', conversationIds)
        .related('attachments');
    },
  ),
  getEmailsForConversationsV2: defineQuery(
    z.object({
      conversationIds: z.array(z.string()),
      channelId: z.string(),
      isMember: z.boolean(),
    }),
    ({ args: { conversationIds } }) => {
      // An empty `IN []` predicate is invalid in Zero/SQL, and this query body
      // runs during hash construction (before the caller's `enabled` flag can
      // suppress it). When there are no conversation IDs, return a query that
      // matches nothing instead — mirrors the vespaTicketIds guard above.
      if (conversationIds.length === 0) {
        return zql.emails
          .where('conversationId', '__no_match__')
          .related('attachments');
      }
      return zql.emails
        .where('conversationId', 'IN', conversationIds)
        .related('attachments');
    },
  ),
  // @deprecated Use getDraftForConversationV2 when channel membership is known.
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
  getDraftForConversationV2: defineQuery(
    z.object({
      conversationId: z.string(),
      channelId: z.string(),
      isMember: z.boolean(),
    }),
    ({ ctx, args: { conversationId } }) => {
      return zql.email_drafts
        .where('conversationId', conversationId)
        .where(({ or, cmp }) =>
          or(cmp('userId', '=', ctx.userID), cmp('userId', 'IS', null)),
        )
        .orderBy('updatedAt', 'desc');
    },
  ),
  // The caller's compose drafts (brand-new emails, no thread) for a channel.
  composeDraftsByChannel: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
      return zql.email_drafts
        .where('channelId', channelId)
        .where('userId', ctx.userID)
        .where('conversationId', 'IS', null)
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
  ticketRowById: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.tickets.where('id', ticketId).one();
  }),
  ticketByIdV2: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.tickets
      .where('id', ticketId)
      .related('project')
      .related('tagMappings')
      .related('assignments', a => a.related('role'))
      .related('referencesOut', ref => ref.related('targetTicket'))
      .related('referencesIn', ref => ref.related('sourceTicket'))
      .related('entity')
      .related('conversation')
      .related('stageEtaEntries')
      .related('ticketStageRequests', a => a.related('form'))
      .one();
  }),
  ticketDetailsByIdV2: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.tickets
      .where('id', ticketId)
      .related('project')
      .related('tagMappings')
      .related('assignments', a => a.related('role'))
      .related('referencesOut', ref => ref.related('targetTicket'))
      .related('referencesIn', ref => ref.related('sourceTicket'))
      .related('entity')
      .related('conversation')
      .related('stageEtaEntries')
      .related('rcas', rcaQuery => rcaQuery.orderBy('createdAt', 'desc').limit(1))
      .related('ticketStageRequests', a => a.related('form'))
      .one();
  }),
  ticketByXyneIdV3: defineQuery(z.object({ xyneId: z.string(), workspaceId: z.string() }), ({ args: { xyneId, workspaceId } }) => {
    return zql.tickets
      .where('xyneId', xyneId)
      .where('workspaceId', workspaceId)
      .related('project')
      .related('tagMappings')
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
  /**
   * Automations live on the `workflows` table with `workflowType='Automations'`.
   * The four queries below are the Zero-backed reads the dashboard uses in
   * place of the legacy `/api/automations/*` GETs. Live-sync means the list
   * + builder + run history all auto-update as the worker mutates the rows
   * (status flips DRAFT→ACTIVE, new `workflow_executions` rows appear as
   * runs fire, etc.).
   *
   * Workspace scoping: every read takes `workspaceId` and filters at the query
   * level. Execution rows have no `workspaceId` of their own — they're scoped
   * via the parent workflow (`workflow.workspaceId`).
   */
  automationsList: defineQuery(
    z.object({ workspaceId: z.string() }),
    ({ args: { workspaceId } }) => {
      // Order by creation time, not last-update — activating / disabling
      // a row updates `updatedAt`, and ordering by that would shuffle the
      // toggled row to the top of the list, which is jarring while the
      // user is scanning rows.
      return zql.workflows
        .where('workflowType', 'Automations')
        .where('workspaceId', workspaceId)
        .orderBy('createdAt', 'desc');
    },
  ),
  automationById: defineQuery(
    z.object({ id: z.string(), workspaceId: z.string() }),
    ({ args: { id, workspaceId } }) => {
      return zql.workflows
        .where('id', id)
        .where('workflowType', 'Automations')
        .where('workspaceId', workspaceId)
        .one();
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
  subTicketMappingsForTickets: defineQuery(
    z.object({ ticketIds: z.array(z.string()) }),
    ({ args: { ticketIds } }) => {
      return zql.ticket_sub_ticket_mappings
        .where(helpers => helpers.cmp('ticketId', 'IN', ticketIds))
        .related('subTicket', subTicketQuery =>
          subTicketQuery.related('conversation').related('mappedTicket'),
        )
        .orderBy('id', 'asc');
    },
  ),
  subTicketsByMappedTicketId: defineQuery(
    z.object({ mappedTicketId: z.string() }),
    ({ args: { mappedTicketId } }) => {
      return zql.sub_tickets.where('mappedTicketId', mappedTicketId).related('ticketMappings');
    },
  ),
  subTicketByMappedTicketId: defineQuery(
    z.object({ mappedTicketId: z.string() }),
    ({ args: { mappedTicketId } }) => {
      return zql.sub_tickets.where('mappedTicketId', mappedTicketId).one();
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
  userVisibleChannelsV3: defineQuery(({ ctx }) => {
    return zql.channel_user_status
      .where('userId', ctx.userID)
      .where('isClosed', false)
      .where('isDeleted', false)
      .related('channel', ch =>
        ch
          .where('type', 'NOT IN', [
            ChannelType.EMAIL,
            ChannelType.SLACK,
            ChannelType.APP,
            ChannelType.CALL,
            ChannelType.SOCIAL_MEDIA,
          ])
          .related('channelStats'),
      );
  }),
  userVisibleEmailChannels: defineQuery(({ ctx }) => {
    return zql.channel_user_status
      .where('userId', ctx.userID)
      .where('isClosed', false)
      .where('isDeleted', false)
      .related('channel', ch =>
        ch
          .where('type', 'IN', [
            ChannelType.EMAIL,
            ChannelType.SLACK,
            ChannelType.APP,
            ChannelType.CALL,
            ChannelType.SOCIAL_MEDIA,
          ])
          .related('channelStats'),
      );
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
        .orderBy('lastReplyAt', 'desc')
        .orderBy('id', 'desc');

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
        .whereExists('user', u =>
          u.where((helpers: any) =>
            helpers.or(
              helpers.cmp('name', 'ILIKE', `%${searchQuery}%`),
              helpers.cmp('displayName', 'ILIKE', `%${searchQuery}%`),
            ),
          ),
        );
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
  getChannelUserStatus: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) =>
      zql.channel_user_status
        .where('channelId', channelId)
        .where('userId', ctx.userID)
        .where('isDeleted', false)
        .one(),
  ),
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
      .where(helpers => helpers.cmp('callType', 'NOT IN', [CallType.HEADLESS]))
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
  userScheduledCallsV2: defineQuery(({ ctx }) => {
    return zql.calls
      .where('status', CallStatus.SCHEDULED)
      .orderBy('startsAt', 'asc')
      .related('participants', p => p.where('userId', ctx.userID));
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

  userCallHistoryV2: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), startedAt: z.number() }).nullable(),
    }),
    ({ ctx, args: { limit, start } }) => {
      let query = zql.calls
        .where(helpers => helpers.cmp('callType', 'NOT IN', [CallType.HEADLESS]))
        .where(helpers =>
          helpers.cmp('status', 'NOT IN', [
            CallStatus.ACTIVE,
            CallStatus.SCHEDULED,
            CallStatus.CANCELLED,
          ]),
        )
        .orderBy('startedAt', 'desc')
        .orderBy('id', 'desc');

      if (start) {
        query = query.start({ id: start.id, startedAt: start.startedAt }, { inclusive: false });
      }

      return query
        .limit(limit)
        .related('participants', p => p.where('userId', ctx.userID));
    },
  ),

  callParticipantsByCallId: defineQuery(
    z.object({ callId: z.string() }),
    ({ args: { callId } }) => {
      return zql.call_participants.where('callId', callId).orderBy('invitedAt', 'asc');
    },
  ),
  userRecordings: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), startedAt: z.number() }).nullable(),
    }),
    ({ ctx, args: { limit, start } }) => {
      let query = zql.calls
        .where('callType', CallType.HEADLESS)
        .where('createdByUserId', ctx.userID)
        .orderBy('startedAt', 'desc')
        .orderBy('id', 'desc');

      if (start) {
        query = query.start({ id: start.id, startedAt: start.startedAt }, { inclusive: false });
      }

      return query.limit(limit);
    },
  ),

  createdOatsRecordings: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), startedAt: z.number() }).nullable(),
      participantId: z.string().nullable(),
    }),
    ({ ctx, args: { limit, start, participantId } }) => {
      let query = zql.calls
        .where('workspaceId', ctx.workspaceId)
        .where('callType', CallType.HEADLESS)
        .where('createdByUserId', ctx.userID)
        .orderBy('startedAt', 'desc')
        .orderBy('id', 'desc');

      if (participantId) {
        query = query.where(({ or, cmp }) =>
          or(
            cmp('createdByUserId', participantId),
            cmp('recordingParticipants', 'LIKE', `%"${participantId}"%`),
          ),
        );
      }

      if (start) {
        query = query.start({ id: start.id, startedAt: start.startedAt }, { inclusive: false });
      }
      return query.limit(limit);
    },
  ),

  sharedOatsRecordings: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), startedAt: z.number() }).nullable(),
      participantId: z.string().nullable(),
    }),
    ({ ctx, args: { limit, start, participantId } }) => {
      let query = zql.calls
        .where('workspaceId', ctx.workspaceId)
        .where('callType', CallType.HEADLESS)
        .where('createdByUserId', '!=', ctx.userID)
        .whereExists('shares', share =>
          share
            .where('shareableEntityType', ShareableEntityType.NOTE_TAKER)
            .where('entityUserAccess', '!=', EntityUserAccess.REVOKED)
            .where(({ or, cmp, exists }) =>
              or(
                cmp('userId', ctx.userID),
                exists('userGroupMemberships', m => m.where('userId', ctx.userID)),
                exists('channelMembers', m => m.where('userId', ctx.userID)),
              ),
            ),
        )
        .orderBy('startedAt', 'desc')
        .orderBy('id', 'desc');

      if (participantId) {
        query = query.where(({ or, cmp }) =>
          or(
            cmp('createdByUserId', participantId),
            cmp('recordingParticipants', 'LIKE', `%"${participantId}"%`),
          ),
        );
      }

      if (start) {
        query = query.start({ id: start.id, startedAt: start.startedAt }, { inclusive: false });
      }
      return query.limit(limit);
    },
  ),

  // Fetches the HEADLESS recording (+ shares) by its public
  // externalId (what's in the URL / RecordingDetail.externalId) — used by
  // the Share modal and the detail screen alike.
  oatsRecordingByExternalId: defineQuery(
    z.object({ callId: z.string() }),
    ({ ctx, args: { callId } }) =>
      zql.calls
        .where('workspaceId', ctx.workspaceId)
        .where('callType', CallType.HEADLESS)
        .where('externalId', callId)
        .related('shares', shares =>
          shares
            .where('shareableEntityType', ShareableEntityType.NOTE_TAKER)
            .where('entityUserAccess', '!=', EntityUserAccess.REVOKED)
            .related('user')
            .related('userGroup')
            .related('channel'),
        )
        .one(),
  ),

  summaryTemplates: defineQuery(
    z.object({}),
    ({ ctx }) =>
      zql.summary_templates
        .where('workspaceId', ctx.workspaceId)
        .where(({ or, and, cmp, exists }) =>
          or(
            cmp('createdBy', ctx.userID),
            cmp('visibility', SummaryTemplateVisibility.PUBLIC),
            and(
              cmp('visibility', SummaryTemplateVisibility.WAITING_FOR_APPROVAL),
              exists('workspaceResourceAccess', access =>
                access
                  .where('accessType', AccessType.ADMIN)
                  .where(({ or: accessOr, cmp: accessCmp, exists: accessExists }) =>
                    accessOr(
                      accessCmp('userId', ctx.userID),
                      accessExists('userGroup', group =>
                        group.whereExists('userGroupMappings', membership =>
                          membership.where('userId', ctx.userID),
                        ),
                      ),
                    ),
                  )
                  .whereExists('resource', resource => resource.where('name', 'SCRIBE')),
              ),
            ),
            exists('shares', share =>
              share
                .where('workspaceId', ctx.workspaceId)
                .where('shareableEntityType', ShareableEntityType.SUMMARY_TEMPLATE)
                .where('entityUserAccess', '!=', EntityUserAccess.REVOKED)
                .where(({ or: shareOr, cmp: shareCmp, exists: shareExists }) =>
                  shareOr(
                    shareCmp('userId', ctx.userID),
                    shareExists('userGroupMemberships', membership =>
                      membership.where('userId', ctx.userID),
                    ),
                    shareExists('channelMembers', member => member.where('userId', ctx.userID)),
                  ),
                ),
            ),
          ),
        )
        .orderBy('name', 'asc')
        .orderBy('version', 'desc'),
  ),

  summaryTemplateById: defineQuery(
    z.object({ templateId: z.string() }),
    ({ ctx, args: { templateId } }) =>
      zql.summary_templates
        .where('workspaceId', ctx.workspaceId)
        .where('id', templateId)
        .one(),
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
      .related('call')
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
      actorTypes: z.array(z.nativeEnum(UserType)).optional(),
    }),
    ({ args: { limit, start, types, classification, isRead, actorTypes } }) => {
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

      // Actor kind lives on users.userType, not on the activity row, so this has to
      // reach through the `actor` relationship. Filtering here rather than on the
      // client keeps `limit` meaningful — a client-side filter would page over all
      // activities and hand back short or empty pages.
      if (actorTypes && actorTypes.length > 0) {
        query = query.whereExists('actor', (actor: any) =>
          actor.where('userType', 'IN', actorTypes),
        );
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
        .related('call')
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

  // Deprecated: userUnreadThreadActivities removed — thread count now derived
  // from userUnreadActivities using isThreadActivity field

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
      includeArchived: z.boolean().optional(),
      onlyArchived: z.boolean().optional(),
    }),
    ({ ctx, args: { folderId, projectId, includeQuartoDocs, includeArchived, onlyArchived } }) => {
      let query = zql.canvases
        .where('folderId', folderId)
        .where('projectId', projectId)
        .where('channelId', 'IS', null);

      if (!includeQuartoDocs) {
        query = query.where('docType', DocType.Canvas);
      }

      query = applyArchiveFilter(query, { includeArchived, onlyArchived });

      return includeCurrentUserCanvasStatus(
        applyCanvasVisibilityQueryFilter(query, ctx.userID).orderBy('updatedAt', 'desc'),
        ctx.userID,
      );
    },
  ),
  channelCanvasesPaginated: defineQuery(
    z.object({
      channelId: z.string(),
      includeQuartoDocs: z.boolean().optional(),
      includeArchived: z.boolean().optional(),
      onlyArchived: z.boolean().optional(),
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
      direction: z.enum(['forward', 'backward']).optional(),
    }),
    ({ ctx, args: { channelId, includeQuartoDocs, includeArchived, onlyArchived, limit, start, direction } }) => {
      const isBackward = direction === 'backward';
      let query = zql.canvases.where(helpers =>
        helpers.or(
          helpers.cmp('channelId', channelId),
          helpers.exists('participants', (p: any) => p.where('channelId', channelId)),
        ),
      );

      if (!includeQuartoDocs) {
        query = query.where('docType', DocType.Canvas);
      }

      query = applyArchiveFilter(query, { includeArchived, onlyArchived });

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

      return includeCurrentUserCanvasStatus(query.limit(limit).related('participants'), ctx.userID);
    },
  ),

  channelQuartoDocsPaginated: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
    }),
    ({ ctx, args: { channelId, limit, start } }) => {
      let query = zql.canvases
        .where('channelId', channelId)
        .where('docType', DocType.Quarto)
        .orderBy('updatedAt', 'desc')
        .orderBy('id', 'desc');

      if (start) {
        query = query.start({ updatedAt: start.updatedAt, id: start.id }, { inclusive: false });
      }

      return includeCurrentUserCanvasStatus(
        query.limit(limit).related('participants').related('channel'),
        ctx.userID,
      );
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

  canvasCommentThreads: defineQuery(
    z.object({ canvasId: z.string() }),
    ({ args: { canvasId } }) => {
      return zql.canvas_comment_threads
        .where('canvasId', canvasId)
        .orderBy('createdAt', 'asc')
        .related('initialComment');
    },
  ),

  canvasThreadComments: defineQuery(
    z.object({ threadId: z.string() }),
    ({ args: { threadId } }) => {
      return zql.canvas_comments
        .where('threadId', threadId)
        .orderBy('createdAt', 'asc');
    },
  ),

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
  ticketExportsForCurrentUser: defineQuery(() => {
    return zql.ticket_exports.orderBy('createdAt', 'desc').limit(100);
  }),
  getAllProjects: defineQuery(() => {
    return zql.projects.orderBy('createdAt', 'desc').related('boards');
  }),
  // Projects only (no boards) — boards are lazy-loaded per project in pickers.
  getAllProjectsList: defineQuery(() => {
    return zql.projects.where('type', '!=', ProjectType.DM).orderBy('createdAt', 'desc');
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

  // Boards mapped to a channel via ChannelBoardMapping.
  // This is the preferred path for resolving channel → boards.
  // Falls back to boardsListByProject on the consumer side if empty.
  boardsByChannel: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.channel_board_mappings
        .where('channelId', channelId)
        .related('board')
        .orderBy('createdAt', 'asc');
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
      includeArchived: z.boolean().optional(),
      onlyArchived: z.boolean().optional(),
    }).refine(args => {
      const scope = args.scope ?? (args.folderId ? 'folder' : 'channel');
      if (scope === 'folder') return Boolean(args.folderId) && !args.channelId;
      if (scope === 'personal_root') return !args.folderId && !args.channelId;
      return Boolean(args.channelId) && !args.folderId;
    }, 'Provide folderId for folder scope or channelId for channel scope'),
    ({ ctx, args: { scope, channelId, folderId, includeQuartoDocs, includeArchived, onlyArchived } }) => {
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

      query = applyArchiveFilter(query, { includeArchived, onlyArchived });

      if (resolvedScope === 'channel_root') {
        query = query.where('folderId', 'IS', null);
      }

      return includeCurrentUserCanvasStatus(
        applyCanvasVisibilityQueryFilter(
          query,
          ctx.userID,
          resolvedScope !== 'personal_root',
        ).orderBy('updatedAt', 'desc'),
        ctx.userID,
      );
    },
  ),

  stagesByBoard: defineQuery(z.object({ boardId: z.string() }), ({ args: { boardId } }) => {
    return zql.stages
      .where('boardId', boardId)
      .orderBy('sequenceNumber', 'asc')
      .related('approvers')
      .related('formContextMappings');
  }),
  stagesByBoards: defineQuery(
    z.object({
      projectId: z.string(),
      boardType: z.nativeEnum(BoardType).optional(),
    }),
    ({ args: { projectId, boardType } }) => {
      return zql.stages
        .whereExists('board', b => {
          const scoped = b.where('projectId', projectId);
          return boardType ? scoped.where('boardType', boardType) : scoped;
        })
        .orderBy('boardId', 'asc')
        .orderBy('sequenceNumber', 'asc');
    },
  ),
  getStageTransitionsByBoardId: defineQuery(
    z.object({ boardId: z.string() }),
    ({ args: { boardId } }) => {
      return zql.stage_transitions
        .where('boardId', boardId)
        .related('transitionApprovers');
    },
  ),
  ticketActivities: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.ticket_activities.where('ticketId', ticketId).orderBy('timestamp', 'desc');
  }),
  ticketActivitiesForTickets: defineQuery(
    z.object({
      ticketIds: z.array(z.string()),
      limit: z.number(),
      start: z.object({ timestamp: z.number(), id: z.string() }).nullable(),
    }),
    ({ args: { ticketIds, limit, start } }) => {
      let query = zql.ticket_activities
        .where(helpers => helpers.cmp('ticketId', 'IN', ticketIds))
        .orderBy('timestamp', 'desc')
        .orderBy('id', 'desc');
      if (start) {
        query = query.start({ timestamp: start.timestamp, id: start.id }, { inclusive: false });
      }
      return query.limit(limit);
    },
  ),
  getCanvas: defineQuery(z.object({ canvasId: z.string() }), ({ ctx, args: { canvasId } }) => {
    // Backward-compat lookup: match by canonical id, userRepo (Quarto), and
    // the legacy viewAccessId/editAccessId columns so historical chat URLs
    // and stored message metadata that carry those IDs still resolve.
    // Visibility is still gated by applyCanvasVisibilityQueryFilter, and edit
    // privileges still flow through participant checks in the canvas.update
    // mutator — matching editAccessId here does NOT grant edit access.
    return applyCanvasVisibilityQueryFilter(
      zql.canvases
      .where(helpers => {
        return helpers.or(
          helpers.cmp('id', canvasId),
          helpers.cmp('userRepo', canvasId),
          helpers.cmp('viewAccessId', canvasId),
          helpers.cmp('editAccessId', canvasId),
        );
      })
      .related('participants')
      .related('channel'),
      ctx.userID,
    ).one();
  }),

  canvasVersions: defineQuery(
    z.object({ canvasId: z.string() }),
    ({ ctx, args: { canvasId } }) => {
      return zql.canvas_versions
        .where('canvasId', canvasId)
        .whereExists('canvas', canvas =>
          applyCanvasVisibilityQueryFilter(canvas, ctx.userID),
        )
        .orderBy('updatedAt', 'desc')
        .orderBy('id', 'desc');
    },
  ),

  userCanvasesPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
      includeQuartoDocs: z.boolean().optional(),
      includeArchived: z.boolean().optional(),
      onlyArchived: z.boolean().optional(),
      direction: z.enum(['forward', 'backward']).optional(),
    }),
    ({ ctx, args }) => {
      const isBackward = args.direction === 'backward';
      let query = applyCanvasVisibilityQueryFilter(zql.canvases, ctx.userID, false);

      if (!args.includeQuartoDocs) {
        query = query.where('docType', DocType.Canvas);
      }

      query = applyArchiveFilter(query, args);

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

      return includeCurrentUserCanvasStatus(query.limit(args.limit).related('participants'), ctx.userID);
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
            helpers.exists('participants', p =>
              p.where(({ or, cmp, exists: ex }) =>
                or(
                  cmp('userId', ctx.userID),
                  ex('userGroup', ug =>
                    ug.whereExists('userGroupMappings', m => m.where('userId', ctx.userID)),
                  ),
                  ex('channel', ch =>
                    ch.whereExists('participants', cp => cp.where('userId', ctx.userID)),
                  ),
                ),
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

      return includeCurrentUserCanvasStatus(query.limit(args.limit).related('participants'), ctx.userID);
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
      return zql.user_group_mappings
        .where('userGroupId', userGroupId)
        .orderBy('createdAt', 'desc')
        .related('role');
    },
  ),

  getUserGroupMembersByGroupIds: defineQuery(
    z.object({ userGroupIds: z.array(z.string()) }),
    ({ args: { userGroupIds } }) => {
      return zql.user_group_mappings.where('userGroupId', 'IN', userGroupIds);
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
  attachmentsByIds: defineQuery(
    z.object({ attachmentIds: z.array(z.string()) }),
    ({ args: { attachmentIds } }) => {
      if (attachmentIds.length === 0) {
        return zql.message_attachments.where('id', '__none__');
      }
      return zql.message_attachments
        .where('entityType', AttachmentEntityType.FORM_ENTITY_VALUE)
        .where('isDeleted', false)
        .where(helpers => helpers.or(...attachmentIds.map(id => helpers.cmp('id', '=', id))));
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
        .where(helpers =>
          helpers.or(
            helpers.cmp('doNotPostToChannel', 'IS', null),
            helpers.cmp('doNotPostToChannel', '=', false),
          ),
        )
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
        .where(helpers =>
          helpers.or(
            helpers.cmp('doNotPostToChannel', 'IS', null),
            helpers.cmp('doNotPostToChannel', '=', false),
          ),
        )
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
        .where(helpers =>
          helpers.or(
            helpers.cmp('doNotPostToChannel', 'IS', null),
            helpers.cmp('doNotPostToChannel', '=', false),
          ),
        )
        .related('initialMessageAttachments')
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
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      limit: z.number(),
    }),
    ({ ctx, args: { channelId, limit } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .where(helpers =>
          helpers.or(
            helpers.cmp('doNotPostToChannel', 'IS', null),
            helpers.cmp('doNotPostToChannel', '=', false),
          ),
        )
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
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      limit: z.number(),
    }),
    ({ ctx, args: { channelId, limit } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .where(helpers =>
          helpers.or(
            helpers.cmp('doNotPostToChannel', 'IS', null),
            helpers.cmp('doNotPostToChannel', '=', false),
          ),
        )
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
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      limit: z.number(),
    }),
    ({ ctx, args: { channelId, limit } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .where(helpers =>
          helpers.or(
            helpers.cmp('doNotPostToChannel', 'IS', null),
            helpers.cmp('doNotPostToChannel', '=', false),
          ),
        )
        .related('initialMessageAttachments')
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
        .where(helpers =>
          helpers.or(
            helpers.cmp('doNotPostToChannel', 'IS', null),
            helpers.cmp('doNotPostToChannel', '=', false),
          ),
        )
        .orderBy('createdAt', 'desc')
        .orderBy('conversationId', 'desc')
        .limit(1)
        .one();
    },
  ),
  // V2: channel access (public-or-participant) is left to MessageAttachmentsACL. V1's inline
  // flipped channel exists materialized every public channel on hydration (Aug 2026 WAL incidents).
  getConversationAttachementsV2: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number(),
      start: z.object({ attachementId: z.string(), createdAt: z.number() }).nullable(),
      direction: z.literal('forward').or(z.literal('backward')),
    }),
    ({ args: { channelId, limit, start, direction } }) => {
      let query = zql.message_attachments.whereExists('conversation', conv =>
        conv.where('channelId', channelId),
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
    ({ ctx, args: { limit, start, direction } }) => {
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
        query = query.start(
          { lastActivityAt: start.lastActivityAt, channelId: start.channelId },
          { inclusive: !isBackward },
        );
      }

      return query
        .limit(limit)
        .related('channel', channelQuery =>
          channelQuery.related('conversations', conversationQuery =>
            conversationQuery
              .whereExists('initialMessage', messageQuery =>
                messageQuery.where(helpers =>
                  helpers.or(
                    helpers.cmp('visibleTo', 'IS', null),
                    helpers.cmp('visibleTo', '=', ctx.userID),
                  ),
                ),
              )
              .orderBy('createdAt', 'desc')
              .limit(1),
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
      .related('formContextMappings', mappingQuery => mappingQuery.related('formFields', q => q.related('globalField')))
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
      .related('formContextMappings', mappingQuery => mappingQuery.related('formFields', q => q.related('globalField')))
      .one();
  }),
  // Query for all ticket entity mappings
  getAllTicketEntityMappings: defineQuery(() => {
    return zql.ticket_entity_mappings;
  }),
  // Query for project tags by project ID
  projectTagsByProjectId: defineQuery(
    z.object({ projectId: z.string() }),
    ({ args: { projectId } }) => {
      return zql.project_tags
        .where('projectId', projectId)
        .orderBy('name', 'asc');
    },
  ),
  // Conversation labels (Gmail-style) — the channel/desk's label catalog for the sidebar.
  conversationLabelsByChannelId: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.conversation_labels.where('channelId', channelId).orderBy('name', 'asc');
    },
  ),

  conversationLabelsByChannelIdV2: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean() }),
    ({ args: { channelId } }) => {
      return zql.conversation_labels.where('channelId', channelId).orderBy('name', 'asc');
    },
  ),
  // Labels applied to a single conversation (for chips on the email thread view).
  conversationLabelMappingsByConversationId: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ args: { conversationId } }) => {
      return zql.conversation_label_mappings
        .where('conversationId', conversationId)
        .orderBy('labelName', 'asc');
    },
  ),
  conversationLabelMappingsByConversationIdV2: defineQuery(
    z.object({
      conversationId: z.string(),
      channelId: z.string(),
      isMember: z.boolean(),
    }),
    ({ args: { conversationId } }) => {
      return zql.conversation_label_mappings
        .where('conversationId', conversationId)
        .orderBy('labelName', 'asc');
    },
  ),
  // The caller's mailbox overlay for a single ticket (ACL scopes to userId = me).
  myTicketMailbox: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.ticket_user_mailbox.where('ticketId', ticketId);
  }),
  myTicketMailboxV2: defineQuery(
    z.object({
      ticketId: z.string(),
      channelId: z.string(),
      isMember: z.boolean(),
    }),
    ({ args: { ticketId } }) => {
      return zql.ticket_user_mailbox.where('ticketId', ticketId);
    },
  ),
  // Query for ticket entity mappings by ticket ID
  getTicketEntityMappingsByTicketId: defineQuery(
    z.object({ ticketId: z.string() }),
    ({ args: { ticketId } }) => {
      return zql.ticket_entity_mappings.where('ticketId', ticketId);
    },
  ),
  // Query for stage transitions by multiple board IDs (used to resolve formId → boardId for stage forms)
  getStageTransitionsByBoardIds: defineQuery(
    z.object({ boardIds: z.array(z.string()) }),
    ({ args: { boardIds } }) => {
      if (boardIds.length === 0) {
        return zql.stage_transitions
          .where('id', 'nonexistent')
          .limit(0)
          .related('form', q => q.related('formFields', q2 => q2.related('globalField')));
      }
      return zql.stage_transitions
        .where('boardId', 'IN', boardIds)
        .related('form', q => q.related('formFields', q2 => q2.related('globalField')));
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
  // Query for assignment states across several user groups at once
  getUserAssignmentStatesByGroupIds: defineQuery(
    z.object({ userGroupIds: z.array(z.string()) }),
    ({ args: { userGroupIds } }) => {
      return zql.user_assignment_states.where('userGroupId', 'IN', userGroupIds);
    },
  ),
  // Query for board complexity scores for a user group
  getBoardComplexityScores: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.board_complexity_scores.where('userGroupId', userGroupId).related('board');
    },
  ),
  // Query for user workload mappings (activeTasks/totalTasks per user per board)
  getUserWorkloadMappings: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.user_workload_mappings.where('userGroupId', userGroupId);
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
  getAllRepos: defineQuery(() => zql.repos.orderBy('name', 'asc')),
  getSdlcRepos: defineQuery(() =>
    zql.repos
      .where('projectId', 'IS NOT', null)
      .where('channelId', 'IS NOT', null)
      .related('project')
      .related('channel', channel => channel.related('participants').related('channelStats'))
      .related('setupExecution')
      .related('sdlcEntityLinks')
      .orderBy('name', 'asc'),
  ),
  getSdlcTracks: defineQuery(z.object({ repoId: z.string() }), ({ args: { repoId } }) =>
    zql.sdlc_tracks.where('repoId', repoId).orderBy('createdAt', 'asc'),
  ),
  getSdlcRepoByChannelId: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => zql.repos.where('channelId', channelId).one(),
  ),
  getSdlcRepoById: defineQuery(z.object({ repoId: z.string() }), ({ args: { repoId } }) =>
    zql.repos
      .where('id', repoId)
      .where('projectId', 'IS NOT', null)
      .where('channelId', 'IS NOT', null)
      .related('project')
      .related('channel', channel =>
        channel
          .related('participants')
          .related('channelStats')
          .related('canvasFolders', folder =>
            folder.related('canvases', canvas => canvas.related('sdlcArtifact')),
          ),
      )
      .related('setupExecution')
      .related('sdlcEntityLinks')
      .one(),
  ),
  getSdlcLinks: defineQuery(z.object({ repoId: z.string() }), ({ args: { repoId } }) =>
    zql.sdlc_entity_links.where('repoId', repoId).orderBy('createdAt', 'asc'),
  ),
  sdlcTicketsByIds: defineQuery(
    z.object({ ticketIds: z.array(z.string()) }),
    ({ args: { ticketIds } }) =>
      zql.tickets
        .where(helpers =>
          helpers.cmp(
            'id',
            'IN',
            ticketIds.length > 0 ? ticketIds : ['__no_sdlc_ticket__'],
          ),
        )
        .related('pullRequests', pullRequest => pullRequest.orderBy('updatedAt', 'desc')),
  ),
  sdlcDiscussionConversations: defineQuery(
    z.object({
      channelId: z.string(),
      conversationIds: z.array(z.string()),
      limit: z.number().int().min(1),
    }),
    ({ ctx, args: { channelId, conversationIds, limit } }) =>
      zql.conversations
        .where('channelId', channelId)
        .where(helpers =>
          helpers.cmp(
            'conversationId',
            'IN',
            conversationIds.length > 0 ? conversationIds : ['__no_sdlc_conversation__'],
          ),
        )
        .where(helpers =>
          helpers.or(
            helpers.cmp('doNotPostToChannel', 'IS', null),
            helpers.cmp('doNotPostToChannel', '=', false),
          ),
        )
        .related('initialMessageAttachments')
        .related('initialMessageNudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery.where(helpers =>
            helpers.or(
              helpers.cmp('userId', '=', ctx.userID),
              helpers.cmp('channelId', '=', channelId),
            ),
          ),
        )
        .related('participants', participantQuery =>
          participantQuery.where('userId', ctx.userID).orderBy('joinedAt', 'asc'),
        )
        .orderBy('lastActivityAt', 'desc')
        .limit(limit),
  ),
  sdlcDiscussionConversation: defineQuery(
    z.object({ channelId: z.string(), conversationId: z.string() }),
    ({ ctx, args: { channelId, conversationId } }) =>
      zql.conversations
        .where('channelId', channelId)
        .where('conversationId', conversationId)
        .where(helpers =>
          helpers.or(
            helpers.cmp('doNotPostToChannel', 'IS', null),
            helpers.cmp('doNotPostToChannel', '=', false),
          ),
        )
        .related('initialMessageAttachments')
        .related('initialMessageNudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery.where(helpers =>
            helpers.or(
              helpers.cmp('userId', '=', ctx.userID),
              helpers.cmp('channelId', '=', channelId),
            ),
          ),
        )
        .related('participants', participantQuery =>
          participantQuery.where('userId', ctx.userID).orderBy('joinedAt', 'asc'),
        )
        .one(),
  ),
  sdlcUserActivities: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number().int().min(1).max(50),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
    }),
    ({ ctx, args: { channelId, limit, start } }) => {
      let query = zql.activities
        .where('userId', ctx.userID)
        .where('channelId', channelId)
        .orderBy('updatedAt', 'desc')
        .orderBy('id', 'desc');
      if (start) {
        query = query.start({ id: start.id, updatedAt: start.updatedAt }, { inclusive: false });
      }
      return query
        .limit(limit)
        .related('message', message => message.related('conversation').related('attachments'))
        .related('reaction')
        .related('canvas')
        .related('call')
        .related('ticket');
    },
  ),
  sdlcRelatedConversations: defineQuery(
    z.object({ conversationIds: z.array(z.string()) }),
    ({ args: { conversationIds } }) =>
      zql.conversations.where(helpers =>
        helpers.cmp(
          'conversationId',
          'IN',
          conversationIds.length > 0 ? conversationIds : ['__no_sdlc_related_conversation__'],
        ),
      ),
  ),
  getAllForms: defineQuery(() => {
    return zql.forms
      .related('formFields', q => q.related('globalField'))
      .related('formContextMappings')
      .orderBy('createdAt', 'desc');
  }),
  // Lightweight forms query - only scalar fields (id, formName, etc.), no related data
  getAllFormsList: defineQuery(() => {
    return zql.forms.orderBy('createdAt', 'desc');
  }),
  getFormById: defineQuery(z.object({ formId: z.string() }), ({ args: { formId } }) => {
    return zql.forms.where('id', formId).one();
  }),
  // Query for form fields by form ID
  // Order by sequenceNumber first; fall back to createdAt for rows where all sequenceNumbers are 0 (e.g. legacy data before backfill)
  getFormFieldsByFormId: defineQuery(z.object({ formId: z.string() }), ({ args: { formId } }) => {
    return zql.form_fields
      .where('formId', formId)
      .related('globalField')
      .orderBy('sequenceNumber', 'asc')
      .orderBy('createdAt', 'asc');
  }),
  // Generic query to fetch all form fields (name and value) for a given entity
  getFormEntityValuesByEntityId: defineQuery(
    z.object({
      entityId: z.string(),
    }),
    ({ args: { entityId } }) => {
      return zql.form_entity_values
        .where('entityId', entityId)
        .related('formField', q => q.related('globalField'))
        .related('globalField')
        .related('attachments')
        .orderBy('createdAt', 'asc');
    },
  ),
  // Query to get forms by context type (e.g., BOARD)
  getFormsByContextType: defineQuery(
    z.object({ contextType: z.nativeEnum(FormContextType) }),
    ({ args: { contextType } }) => {
      return zql.forms
        .where('contextType', contextType)
        .related('formFields', q => q.related('globalField'))
        .related('formContextMappings')
        .orderBy('createdAt', 'desc');
    },
  ),
  getFormMappingsByBoardIds: defineQuery(
    z.object({ boardIds: z.array(z.string()) }),
    ({ args: { boardIds } }) => {
      if (boardIds.length === 0) {
        return zql.forms_context_mapping
          .where('id', 'nonexistent')
          .limit(0)
          .related('formFields', q => q.related('globalField'));
      }
      return zql.forms_context_mapping
        .where('contextId', 'IN', boardIds)
        .where('contextType', 'BOARD' as FormContextType)
        .where('entityType', 'TICKET' as FormEntityType)
        .related('formFields', q => q.related('globalField'));
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
        .related('formFields', q => q.related('globalField'))
        .one();
    },
  ),
  // Plural variant: fetch the form mappings for several contexts at once (e.g.
  // the distinct boards a release's dev tickets span). Returns an array so
  // callers can union the fields across boards.
  getFormMappingsByContextIds: defineQuery(
    z.object({
      contextIds: z.array(z.string()),
      contextType: z.nativeEnum(FormContextType),
      entityType: z.nativeEnum(FormEntityType),
    }),
    ({ args: { contextIds, contextType, entityType } }) => {
      return zql.forms_context_mapping
        .where('contextId', 'IN', contextIds)
        .where('contextType', contextType)
        .where('entityType', entityType)
        .related('formFields', q => q.related('globalField'));
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

  // ART rows scoped to a release ticket. Joins through the per-app SubTicket
  // mapping so we get all (SubTicket × dev-ticket) testing cells under the
  // chosen release ticket.
  applicationReleaseTicketsByReleaseId: defineQuery(
    z.object({
      releaseId: z.string().min(1),
      // Cursor pagination is optional: the Testing tab passes limit+start to page
      // through rows, while the CSV export (and any full-set caller) omits both to
      // materialize every ART row in one view. orderBy adds `id` as a tiebreaker so
      // the (createdAt, id) cursor is stable.
      limit: z.number().optional(),
      start: z.object({ createdAt: z.number(), id: z.string() }).nullable().optional(),
      // Gates the heavy workflows/tags/formEntityValues relations (only the
      // optional "Add column" cells need them). Off by default to keep sync lean.
      includeColumnData: z.boolean().optional(),
    }),
    ({ args: { releaseId, limit, start, includeColumnData } }) => {
      let query = zql.application_release_tickets
        .where('releaseId', releaseId)
        .related('devTicket', q => {
          let devTicket = q
            .one()
            // Only the latest PR is rendered (pullRequests[0]); limit keeps the
            // relation from hydrating a ticket's full PR history.
            .related('pullRequests', pullRequests => pullRequests.orderBy('date', 'desc').limit(1));
          if (includeColumnData) {
            devTicket = devTicket.related('workflows').related('tags').related('formEntityValues');
          }
          return devTicket;
        })
        .related('subTicket', subTicket =>
          subTicket.one().related('mappedTicket', mappedTicket => mappedTicket.one()),
        )
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc');

      if (start) {
        query = query.start({ createdAt: start.createdAt, id: start.id }, { inclusive: false });
      }

      return limit !== undefined ? query.limit(limit) : query;
    },
  ),

  // Audit log of everything that happened on a release ticket — commit analysis
  // runs, SubTicket provisioning, env/migration captures, ART-write failures,
  // canvas publishes. Powers the Timeline tab on the Release Detail screen.
  // Ordered newest-first so the most recent event is at the top of the feed.
  // Bounded: the audit log grows on every re-run. Keep in sync with the backend copy.
  releaseEventsByReleaseId: defineQuery(
    z.object({ releaseId: z.string().min(1), limit: z.number().int().positive().max(100) }),
    ({ args: { releaseId, limit } }) => {
      return zql.release_events
        .where('releaseId', releaseId)
        .where('eventName', '!=', 'FORM_SAVED')
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(limit);
    },
  ),

  // Per-instance release change anchors (env + migration) scoped to a release ticket.
  // Each row pairs with a form_entity_values bag (entityId = row id) carrying the
  // kind-specific fields. Filters releaseId NOT NULL implicitly via the equality
  // check, so legacy pre-v2 registry rows (releaseId IS NULL) never appear.
  releaseChangesByReleaseId: defineQuery(
    z.object({ releaseId: z.string().min(1) }),
    ({ args: { releaseId } }) => {
      return zql.release_change_types
        .where('releaseId', releaseId)
        .related('application')
        .orderBy('createdAt', 'desc');
    },
  ),

  // Form values for the env + migration change instances under a release ticket.
  // contextId on form_entity_values is the release ticket id (set by the writer),
  // entityId on each row is the matching release_change_types.id — zip client-side.
  releaseChangeFormValuesByReleaseId: defineQuery(
    z.object({ releaseId: z.string().min(1) }),
    ({ args: { releaseId } }) => {
      // Excludes changeLog rows: those carry multi-KB diff bodies and are
      // synced separately (releaseChangeLogValuesByReleaseId) only when the
      // Migrations tab actually needs them.
      return zql.form_entity_values
        .where('contextId', releaseId)
        .where(({ or, cmp }) =>
          or(
            cmp('entityType', 'RELEASE_ENV_FORM'),
            cmp('entityType', 'RELEASE_MIGRATION_FORM'),
          ),
        )
        .where(({ or, exists }) =>
          or(
            exists('formField', q => q.where('fieldName', '!=', 'changeLog')),
            exists('globalField', q => q.where('fieldName', '!=', 'changeLog')),
          ),
        )
        .related('formField')
        .related('globalField');
    },
  ),

  releaseChangeLogValuesByReleaseId: defineQuery(
    z.object({ releaseId: z.string().min(1) }),
    ({ args: { releaseId } }) => {
      // The heavy half of releaseChangeFormValuesByReleaseId: changeLog rows
      // carrying full migration diff bodies.
      return zql.form_entity_values
        .where('contextId', releaseId)
        .where(({ or, cmp }) =>
          or(
            cmp('entityType', 'RELEASE_ENV_FORM'),
            cmp('entityType', 'RELEASE_MIGRATION_FORM'),
          ),
        )
        .where(({ or, exists }) =>
          or(
            exists('formField', q => q.where('fieldName', 'changeLog')),
            exists('globalField', q => q.where('fieldName', 'changeLog')),
          ),
        )
        .related('formField')
        .related('globalField');
    },
  ),

  releaseTickets: defineQuery(() => {
    return zql.tickets
      .where('ticketType', BaseTicketType.Release)
      .where('isArchived', false)
      .orderBy('createdAt', 'desc');
  }),

  // Release tickets scoped to a project — drives the per-project release list.
  releaseTicketsByProjectId: defineQuery(
    z.object({ projectId: z.string() }),
    ({ args: { projectId } }) => {
      return zql.tickets
        .where('ticketType', BaseTicketType.Release)
        .where('projectId', projectId)
        .where('isArchived', false)
        .orderBy('createdAt', 'desc')
        // Release history grows forever; the Releases tab only shows recent
        // releases, so cap the per-client materialized view.
        .limit(100);
    },
  ),

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

  getTicketStageRequests: defineQuery(
    z.object({ ticketId: z.string() }),
    ({ args: { ticketId } }) => {
      return zql.ticket_stage_requests
        .where('ticketId', ticketId)
        .related('reviewerCommentMessage')
        .orderBy('createdAt', 'desc');
    },
  ),
  getOpenTicketStageRequestsByStageId: defineQuery(
    z.object({ stageId: z.string() }),
    ({ args: { stageId } }) => {
      return zql.ticket_stage_requests
        .where('stageId', stageId)
        .where(helpers =>
          helpers.or(
            helpers.cmp('status', '=', TicketStageRequestStatus.DRAFT),
            helpers.cmp('status', '=', TicketStageRequestStatus.SUBMITTED),
          )
        );
    },
  ),

  // Apps Queries
  // (getAllAppsPaginated removed — it returned every app across all orgs unscoped.)

  // Installed view — apps installed in the caller's workspace (workspace via the app user).
  getWorkspaceInstalledApps: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ createdAt: z.number(), id: z.string() }).nullable(),
    }),
    ({ ctx, args: { limit, start } }) => {
      let query = zql.installed_apps
        .whereExists('user', (u) => u.where('workspaceId', ctx.workspaceId))
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc');
      if (start) {
        query = query.start({ createdAt: start.createdAt, id: start.id }, { inclusive: false });
      }
      return query.limit(limit).related('app');
    },
  ),

  // Org view — ORG-scoped apps for the caller's org. orgId is supplied by the client; the
  // caller gates this query with `enabled: !!orgId` so it never runs with an empty orgId.
  getOrgApps: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ createdAt: z.number(), id: z.string() }).nullable(),
      orgId: z.string(),
    }),
    ({ args: { limit, start, orgId } }) => {
      let query = zql.apps
        .where(({ and, cmp }) => and(cmp('scope', "ORG"), cmp('orgId', orgId)))
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc');
      if (start) {
        query = query.start({ createdAt: start.createdAt, id: start.id }, { inclusive: false });
      }
      // No `installations` relation: it would expose other workspaces' install rows. The caller's
      // own install state comes from getWorkspaceInstalledApps (workspace-scoped) on the client.
      return query.limit(limit);
    },
  ),

  // Marketplace view — GLOBAL apps across all orgs.
  getMarketplaceApps: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ createdAt: z.number(), id: z.string() }).nullable(),
    }),
    ({ args: { limit, start } }) => {
      let query = zql.apps
        .where('scope', "GLOBAL")
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc');
      if (start) {
        query = query.start({ createdAt: start.createdAt, id: start.id }, { inclusive: false });
      }
      // No `installations` relation — see getOrgApps. Cross-org install rows must not leak.
      return query.limit(limit);
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

  savedConfigsByUser: defineQuery(z.object({ userId: z.string() }), ({ args: { userId } }) => {
    return zql.saved_user_configurations
      .where('userId', userId)
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

  // Knowledge Base queries
  collectionSubfolders: defineQuery(
    z.object({ rootCollectionId: z.string() }),
    ({ args: { rootCollectionId } }) => {
      return zql.collections
        .where('parentId', 'IS NOT', null)
        .where('rootCollectionId', rootCollectionId)
        .where('deletedAt', 'IS', null)
        .orderBy('createdAt', 'asc');
    },
  ),

  collectionItems: defineQuery(
    z.object({ collectionId: z.string() }),
    ({ args: { collectionId } }) => {
      return zql.collection_items
        .where('collectionId', collectionId)
        .where('isLatest', true)
        .where('deletedAt', 'IS', null)
        .orderBy('createdAt', 'asc')
        .related('attachment', a =>
          a.where('entityType', AttachmentEntityType.COLLECTION).where('isDeleted', false),
        );
    },
  ),

  // Every latest, non-deleted file across a whole collection (matched on
  // rootCollectionId, so it spans subfolders). Powers the root "collection
  // status" drawer, which lists each file's ingestion status + size.
  collectionFilesByRoot: defineQuery(
    z.object({ rootCollectionId: z.string() }),
    ({ args: { rootCollectionId } }) => {
      return zql.collection_items
        .where('rootCollectionId', rootCollectionId)
        .where('isLatest', true)
        .where('deletedAt', 'IS', null)
        .orderBy('createdAt', 'asc')
        // The attachment joins on entityId only; a collection_item's id (a globally
        // unique cuid) never keys a non-COLLECTION attachment, so an entityType
        // filter would be redundant. Only isDeleted matters — skip soft-deleted rows.
        .related('attachment', a => a.where('isDeleted', false));
    },
  ),

  // Single collection by id (e.g. to resolve its name for an Activity row).
  collectionById: defineQuery(z.object({ id: z.string() }), ({ args: { id } }) => {
    return zql.collections.where('id', id).where('deletedAt', 'IS', null);
  }),

  // Collections filtered by generic scope (scopeType + scopeId).
  // For channel-scoped collections pass { scopeType: 'CHANNEL', scopeId: channelId }.
  // Future scopes (THREAD, TICKET, …) just use a different scopeType — no schema change needed.
  // Root collections, optionally filtered by scope. Pass { scopeType, scopeId }
  // (e.g. { scopeType: 'CHANNEL', scopeId: channelId }) to scope to a channel; pass
  // {} to get ALL collections the user can access (used by the Ask AI picker from
  // any chat). Access is enforced by the collections ACL either way.
  scopedCollections: defineQuery(
    z.object({
      scopeType: z.string().optional(),
      scopeId: z.string().optional(),
    }),
    ({ ctx, args: { scopeType, scopeId } }) => {
      const base = zql.collections.where('parentId', 'IS', null).where('deletedAt', 'IS', null);
      const scoped =
        scopeType && scopeId ? base.where('scopeType', scopeType).where('scopeId', scopeId) : base;
      return scoped
        .related('permissions', p =>
          // Direct grant, OR a grant on a group/channel this user belongs to —
          // otherwise a group/channel-only grant never resolves a role here
          // (same fix as scopedCollectionsWithItems below).
          p.where(({ or, cmp, exists }) =>
            or(
              cmp('userId', '=', ctx.userID),
              exists('userGroup', ug =>
                ug.whereExists('userGroupMappings', m => m.where('userId', ctx.userID)),
              ),
              exists('channel', ch => ch.whereExists('participants', cp => cp.where('userId', ctx.userID))),
            ),
          ),
        )
        .orderBy('createdAt', 'asc');
    },
  ),

  // Like `scopedCollections`, but also relates every latest, non-deleted file
  // in each collection (via rootCollectionId) so the KB root view can show a
  // per-collection "X / Y ingested" rollup. Kept separate from
  // `scopedCollections` so the Ask-AI collection pickers don't pay to sync all
  // item rows.
  scopedCollectionsWithItems: defineQuery(
    z.object({ scopeType: z.string().optional(), scopeId: z.string().optional() }),
    ({ ctx, args: { scopeType, scopeId } }) => {
      const base = zql.collections.where('parentId', 'IS', null).where('deletedAt', 'IS', null);
      const scoped =
        scopeType && scopeId ? base.where('scopeType', scopeType).where('scopeId', scopeId) : base;
      return scoped
        .related('permissions', p =>
          // Direct grant, OR a grant on a group/channel this user belongs to —
          // otherwise a group/channel-only grant never reaches the client at
          // all, and useGlobalCollections falls back to the VIEWER default
          // even though the server mutators would allow the write.
          p.where(({ or, cmp, exists }) =>
            or(
              cmp('userId', '=', ctx.userID),
              exists('userGroup', ug =>
                ug.whereExists('userGroupMappings', m => m.where('userId', ctx.userID)),
              ),
              exists('channel', ch => ch.whereExists('participants', cp => cp.where('userId', ctx.userID))),
            ),
          ),
        )
        .related('allItems', i => i.where('isLatest', true).where('deletedAt', 'IS', null))
        .orderBy('createdAt', 'asc');
    },
  ),

  // Every explicit grant (per-user or per-group) on a root collection — the
  // "Who has access" list in ShareCollectionModal.
  collectionPermissions: defineQuery(
    z.object({ collectionId: z.string() }),
    ({ args: { collectionId } }) => {
      return zql.collection_permissions
        .where('collectionId', collectionId)
        .related('user')
        .related('userGroup')
        .related('channel');
    },
  ),


  // Stable single-arg query: keying on the project avoids both the
  // boards->applications request waterfall and re-registering a new IN-list
  // view on zero-cache every time the board set changes.
  applicationsByProjectId: defineQuery(
    z.object({ projectId: z.string() }),
    ({ args: { projectId } }) => {
      return zql.applications.where('projectId', projectId);
    },
  ),
  roles: defineQuery(
    z.object({
      limit: z.number().optional(),
      start: z.object({ id: z.string(), createdAt: z.number() }).nullable().optional(),
    }),
    ({ ctx, args: { limit, start } }) => {
      let query = zql.roles
        .where('workspaceId', ctx.workspaceId)
        .where('isActive', true)
        .orderBy('createdAt', 'desc');

      if (start) {
        query = query.start({ id: start.id, createdAt: start.createdAt }, { inclusive: false });
      }

      if (limit !== undefined) {
        query = query.limit(limit);
      }

      return query;
    },
  ),
  roleById: defineQuery(z.object({ id: z.string() }), ({ ctx, args: { id } }) => {
    return zql.roles
      .where('id', id)
      .where('workspaceId', ctx.workspaceId)
      .where('isActive', true)
      .related('userMappings')
      .one();
  }),
});
