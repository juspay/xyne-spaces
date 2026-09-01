import {
  createBuilder,
  defineQueries,
  type AnyQueryRegistry,
  type AnyQueryDefinition,
  type QueryRegistry,
} from '@rocicorp/zero';
import {
  AccessType,
  BaseTicketType,
  BoardType,
  CallType,
  defineQuery,
  DocType,
  EntityUserAccess,
  flowStepVisibilitySchemaShape,
  FormContextType,
  FormEntityType,
  LookupType,
  ShareableEntityType, SummaryTemplateVisibility, UserResponsibility } from '@xyne/shared';
import { z } from 'zod';
import {
  CanvasVisibility,
  ChannelVisibility,
  CallStatus,
  ChannelScopeType,
  ConversationParticipation,
  schema,
  ChannelRole,
  AttachmentEntityType,
  ChannelType,
  SDLC_MEMBERSHIP_RELATION,
  SDLC_STRUCTURAL_RELATIONS,
  SDLC_TRACK_MEMBERSHIP_RELATION,
  EmailType,
  ActivityClassification, LinkVisibility,
  NudgeState,
  SavedConfigContextType,
  Status,
  ProjectType,
  TicketPriority,
  TicketStageRequestStatus,
  MailboxState,
  MessageArtifactStatus,
  TicketStatusV2,
  TicketReferenceRelation,
  DelayedMessageStatus,
  RecapEntityType,
  UserType,
} from '@xyne/shared';

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

const kanbanTicketsPageV2ArgsSchema = kanbanTicketsPageArgsSchema.extend({
  filters: kanbanTicketPageV2FiltersSchema.optional(),
  dir: z.literal('forward').or(z.literal('backward')).optional(),
  showOverdueOnly: z.boolean().optional(),
  overdueReferenceTime: z.number().optional(),
});

type KanbanTicketsPageV2Args = z.infer<typeof kanbanTicketsPageV2ArgsSchema>;

const kanbanTicketsPageV3ArgsSchema = kanbanTicketsPageV2ArgsSchema;

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
    })
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
      ...(dynamicFieldFilters ?? []).map((fieldFilter) => fieldFilter.fieldId),
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

const applyOverdueStageEtaFilter = <
  TArgs extends { showOverdueOnly?: boolean; overdueReferenceTime?: number }
>(
  query: any,
  args: TArgs,
) => {
  if (!args.showOverdueOnly) return query;

  const overdueBefore = args.overdueReferenceTime ?? Date.now();
  return query.where((helpers: any) =>
    helpers.and(
      helpers.cmp('statusV2', '!=', TicketStatusV2.COMPLETED),
      helpers.cmp('statusV2', '!=', TicketStatusV2.CANCELLED),
      helpers.exists('stageEtaEntries', (stageEtaEntry: any) =>
        stageEtaEntry.where('stageLeftAt', 'IS', null).where('stageEta', '<', overdueBefore),
      ),
    ),
  );
};

// Shared logic for V2 extended filters (role assignments) - does NOT include overdue filtering
const applyKanbanTicketPageV2BaseConditions = (
  query: any,
  ctx: { userID: string },
  args: KanbanTicketsPageV2Args,
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

  return query;
};

// V2: Uses stageEtaEntries relation for overdue filtering (same as main branch)
const applyKanbanTicketPageV2Conditions = (
  query: any,
  ctx: { userID: string },
  args: KanbanTicketsPageV2Args,
) => {
  query = applyKanbanTicketPageV2BaseConditions(query, ctx, args);
  return applyOverdueStageEtaFilter(query, args);
};

// V3: Uses isStageOverdue column instead of stageEtaEntries relation
const applyKanbanTicketPageV3Conditions = (
  query: any,
  ctx: { userID: string },
  args: KanbanTicketsPageV3Args,
) => {
  query = applyKanbanTicketPageV2BaseConditions(query, ctx, args);

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
    )
  );

const includeCurrentUserCanvasStatus = (query: any, userId: string) =>
  query.related('userStatuses', (status: any) => status.where('userId', userId));

// Keep in sync with the identical helper in packages/shared/src/zero/queries.ts if archive-filter behavior changes.
const applyArchiveFilter = <T extends { where: Function }>(
  query: T,
  { includeArchived, onlyArchived }: { includeArchived?: boolean; onlyArchived?: boolean },
): T => {
  if (onlyArchived) return query.where('isArchived', true);
  if (!includeArchived) return query.where('isArchived', false);
  return query;
};

export const queries: AnyQueryRegistry = defineQueries({
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

  // Conversation and Message Queries
  channelConversations: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean() }),
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
            .related('nudgeCounts', nudgeCountsQuery =>
              nudgeCountsQuery
                .where(helpers =>
                  helpers.or(
                    helpers.cmp('userId', '=', ctx.userID),
                    helpers.cmp('channelId', '=', channelId),
                  )
                )
            )
        )
        .related('parentMessage', (parentQuery) =>
          parentQuery.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)),
          ),
        )
        .related('participants', (participantQuery) =>
          participantQuery
            .where('participationType', ConversationParticipation.AUTHOR)
            .orderBy('joinedAt', 'asc')
        )
        .related('ticket');
    }
  ),
  channelConversationsV2: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean() }),
    ({ ctx, args: { channelId } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .orderBy('createdAt', 'asc')
        .related('initialMessage', (initialMessageQuery) =>
          initialMessageQuery
            .where(({ or, cmp }) =>
              or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
            )
            .related('attachments')
        )
        .related('parentMessage', (parentQuery) =>
          parentQuery.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)),
          ),
        )
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
        .related('reactions')
        .related('nudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery
            .where(helpers =>
              helpers.or(
                helpers.cmp('userId', '=', ctx.userID),
                helpers.cmp('channelId', 'IS NOT', null),
              )
            )
        );
    }
  ),
  conversationMessagesV2: defineQuery(
    z.object({ conversationId: z.string() }),
    ({ ctx, args: { conversationId } }) => {
      return zql.messages
        .where('conversationId', conversationId)
        .where(({ or, cmp }) => or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)))
        .orderBy('createdAt', 'asc')
        .related('attachments')
        .related('nudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery
            .where(helpers =>
              helpers.or(
                helpers.cmp('userId', '=', ctx.userID),
                helpers.cmp('channelId', 'IS NOT', null),
              )
            )
        );
    }
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
        .related('parentMessage', (parentQuery) =>
          parentQuery.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)),
          ),
        )
        .related('participants')
        .related('ticket')
        .one();
    }
  ),


  // If channel Id is available use this instead of getConversationById to leverage ACL optimizations for channel conversations
  getConversationByIdWithChannel: defineQuery(
    z.object({ conversationId: z.string(), channelId: z.string(), isMember: z.boolean() }),
    ({ ctx, args: { conversationId } }) => {
      return zql.conversations
        .where('conversationId', conversationId)
        .related('initialMessage', (im) =>
          im.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
          )
        )
        .related('parentMessage', (parentQuery) =>
          parentQuery.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)),
          ),
        )
        .related('participants')
        .related('ticket')
        .one();
    },
  ),

  // @deprecated
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
        .related('ticket')
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
    }
  ),
  getConversationByCallId: defineQuery(
    z.object({ callId: z.string() }),
    ({ ctx, args: { callId } }) => {
      return zql.conversations
        .where('callId', callId)
        .related('initialMessage', (im) =>
          im.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
          )
        )
        .one();
    }
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
    }
  ),

  allTickets: defineQuery(() => {
    return zql.tickets
      .where('isArchived', false)
      .orderBy('createdAt', 'desc')
      .related('project')
      .related('assignments')
      .related('stageEtaEntries');
  }),

  // Centralized ticket query with view mode
  // @deprecated
 ticketsQuery: defineQuery(
    z.object({
      viewMode: z.enum(['project', 'board', 'my-tickets', 'user-tickets', 'group-tickets']),
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
        projectId,
        boardId,
        userId,
        groupId,
        excludeFlowSteps,
        formEntityValueFieldIds,
      },
    }) => {
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
        .related('assignments')
        .related('stageEtaEntries');

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
  // V2: includes .related('tagMappings') for per-ticket tag display from new data model
  ticketsQueryV2: defineQuery(
    z.object({
      viewMode: z.enum(['project', 'board', 'my-tickets', 'user-tickets', 'group-tickets']),
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
        projectId,
        boardId,
        userId,
        groupId,
        excludeFlowSteps,
        formEntityValueFieldIds,
      },
    }) => {
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
        .related('tagMappings')
        .related('stageEtaEntries');

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

  kanbanTicketsPageV2: defineQuery(
    kanbanTicketsPageV2ArgsSchema,
    ({ ctx, args }) => {
      const dir = args.dir ?? 'forward';
      let query = applyKanbanTicketPageV2Conditions(zql.tickets, ctx, args)
        .orderBy('createdAt', dir === 'forward' ? 'desc' : 'asc')
        .orderBy('id', dir === 'forward' ? 'asc' : 'desc');

      if (args.start) {
        query = query.start({ createdAt: args.start.createdAt, id: args.start.id }, { inclusive: false });
      }

      let finalQuery = query
        .limit(args.limit)
        .related('assignments', (a: any) => a.related('role'))
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
  // @deprecated
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
  ticketsForEmailChannelsV2: defineQuery(() => {
    return zql.tickets
      .whereExists('conversation', (conversation) =>
        conversation.whereExists('channel', (channel) => channel.where('type', ChannelType.EMAIL))
      )
      .orderBy('createdAt', 'desc')
      .related('project')
      .related('tagMappings')
      .related('entity')
      .related('conversation');
  }),

  // Unified query for Xyne Desk: tickets scoped to a single channel.
  // channelId + isMember are required and forwarded to TicketsACL for membership gating.
  // @deprecated
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
  // @deprecated
  supportTicketsFilteredV2: defineQuery(
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      merchantMid: z.string().optional(),
      assignedTo: z.array(z.string()).optional(),
      priority: z.array(z.nativeEnum(TicketPriority)).optional(),
      stageName: z.array(z.string()).optional(),
      aiCategory: z.array(z.string()).optional(),
      hasAiDraft: z.boolean().optional(),
    }),
    ({ args: { channelId, merchantMid, assignedTo, priority, stageName, aiCategory, hasAiDraft } }) => {
      let query = zql.tickets.where('channelId', channelId);
      query = query.where('isArchived', false);

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

      if (aiCategory && aiCategory.length > 0) {
        query = query.where(({ or, cmp }) => or(...aiCategory.map((c) => cmp('aiCategory', c))));
      }

      if (hasAiDraft) {
        query = query.where(({ exists }) =>
          exists('emailDrafts', (draft) => draft.where('userId', 'IS', null)),
        );
      }

      return query
        .orderBy('createdAt', 'desc')
        .related('project')
        .related('tags')
        .related('entity')
        .related('conversation', (c) => c.related('channel'));
    }
  ),
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
    ({ ctx, args: { channelId, merchantMid, assignedTo, createdBy, priority, stageName, aiCategory, hasAiDraft, userGroups, lastEmailAtStart, lastEmailAtEnd, createdAtStart, createdAtEnd, conversationLabelId, dynamicFieldFilters, formEntityValueFieldIds } }) => {
      let query = zql.tickets.where('channelId', channelId);

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
        .related('conversation', (c) => c.related('channel'))
        .related('emailReads', (q) => q.where('userId', ctx.userID))
        .related('formEntityValues', (fev) =>
          relateSupportDynamicFieldValues(fev, dynamicFieldFilters, formEntityValueFieldIds),
        );
    }
  ),

  // Topics Explorer: one desk's tickets in a created-at window, rolled up client-side.
  // Not supportTicketsPageV3 — that pulls emailDrafts, emailReads, userMailbox and
  // formEntityValues per row, where this reads scalar columns and no relation at all.
  // The window bounds the sync: the panel caps its range at 7 days and opens on one.
  // channelId + isMember are forwarded to TicketsACL for membership gating.
  topicsExplorerTickets: defineQuery(
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      createdAtStart: z.number(),
      createdAtEnd: z.number(),
    }).refine(
      args => args.createdAtStart <= args.createdAtEnd,
      'createdAtStart must be less than or equal to createdAtEnd',
    ),
    ({ args: { channelId, createdAtStart, createdAtEnd } }) =>
      zql.tickets
        .where('channelId', channelId)
        .where('isArchived', false)
        .where('createdAt', '>=', createdAtStart)
        .where('createdAt', '<=', createdAtEnd)
        .orderBy('createdAt', 'desc'),
  ),
  // Single-row variant matching supportTicketsPage row shape (for @rocicorp/zero-virtual permalinks).
  // channelId + isMember are forwarded to TicketsACL for membership gating.
  // @deprecated
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
  // @deprecated
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
  // @deprecated
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
  // @deprecated
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
    }
  ),
  // @deprecated
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
    }
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
    }
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
    }
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
    }
  ),
  // Paginated variant of supportTicketsFiltered for use with @rocicorp/zero-virtual.
  // Cursor = (lastEmailAt, id) matching the orderBy. Active threads bubble up.
  // channelId + isMember are forwarded to TicketsACL for membership gating.
  // @deprecated
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
    }
  ),
  // @deprecated
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
    }
  ),

  supportTicketsPageV3: defineQuery(
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      assignedTo: z.array(z.string()).optional(),
      createdBy: z.array(z.string()).optional(),
      priority: z.array(z.nativeEnum(TicketPriority)).optional(),
      stageName: z.array(z.string()).optional(),
      aiCategory: z.array(z.string()).optional(),
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
    ({ ctx, args: { channelId, assignedTo, createdBy, priority, stageName, aiCategory, hasAiDraft, mailboxFolder, userGroups, lastEmailAtStart, lastEmailAtEnd, createdAtStart, createdAtEnd, conversationLabelId, dynamicFieldFilters, limit, start, dir } }) => {
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
          exists('userMailbox', (m) => m.where('userId', ctx.userID).where('state', MailboxState.SPAM)),
        );
      } else if (mailboxFolder === 'starred') {
        query = query.where(({ exists }) =>
          exists('userMailbox', (m) =>
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
          exists('emails', (e) =>
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
          exists('emailDrafts', (d) =>
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

      return query
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
        .related('formEntityValues', (fev) =>
          relateSupportDynamicFieldValues(fev, dynamicFieldFilters),
        );
    }
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
    }
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
    }
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
    }
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
    }
  ),
  // KEEP IN SYNC with shared. The caller's compose drafts (no thread) for a channel.
  composeDraftsByChannel: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
      return zql.email_drafts
        .where('channelId', channelId)
        .where('userId', ctx.userID)
        .where('conversationId', 'IS', null)
        .orderBy('updatedAt', 'desc');
    }
  ),
  // @deprecated
  userEmailDrafts: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
    }),
    ({ ctx, args: { channelId, limit, start } }) => {
      let query = zql.email_drafts
        .where('channelId', channelId)
        .where('userId', '=', ctx.userID)
        // Reply drafts only. Compose drafts (conversationId IS NULL) live in the same
        // table but are paginated separately (composeDraftsByChannel); without this they
        // would consume page slots here and can hide reply drafts behind the keyset window.
        .where('conversationId', 'IS NOT', null)
        // id is part of the keyset cursor below, so it must also be in the sort —
        // otherwise drafts sharing an updatedAt can be skipped/duplicated across pages.
        .orderBy('updatedAt', 'desc')
        .orderBy('id', 'desc');

      if (start) {
        query = query.start({ updatedAt: start.updatedAt, id: start.id }, { inclusive: false });
      }

      return query
        .limit(limit)
        .related('ticket');
    }
  ),
  // Per-desk "Sent" view: outbound emails in a channel (REPLY / REPLY_ALL /
  // COMPOSE), newest-first, keyset-paginated on (createdAt, id).
  //   scope 'mine'    → only the current user's sends (ctx.userID is the boundary).
  //   scope 'channel' → every user's sends in the channel; gated to channel
  //                     members (public channel, or a participant of a private one)
  //                     so a crafted request can't read another channel's mail.
  // @deprecated
  userEmailsSent: defineQuery(
    z.object({
      channelId: z.string(),
      limit: z.number(),
      start: z.object({ id: z.string(), createdAt: z.number() }).nullable(),
      scope: z.enum(['mine', 'channel']).optional(),
    }),
    ({ ctx, args: { channelId, limit, start, scope = 'mine' } }) => {
      let query = zql.emails
        .where('channelId', channelId)
        .where('type', 'IN', [EmailType.REPLY, EmailType.REPLY_ALL, EmailType.COMPOSE]);

      if (scope === 'channel') {
        query = query.whereExists('channel', ch =>
          ch.where(helpers =>
            helpers.or(
              helpers.cmp('visibility', ChannelVisibility.PUBLIC),
              helpers.and(
                helpers.cmp('visibility', ChannelVisibility.PRIVATE),
                helpers.exists('participants', p => p.where('userId', ctx.userID)),
              ),
            ),
          ),
        );
      } else {
        query = query.where('sentByUserId', '=', ctx.userID);
      }

      // id is part of the keyset cursor below, so it must also be in the sort —
      // otherwise emails sharing a createdAt can be skipped/duplicated across pages.
      query = query.orderBy('createdAt', 'desc').orderBy('id', 'desc');

      if (start) {
        query = query.start({ createdAt: start.createdAt, id: start.id }, { inclusive: false });
      }

      return query
        .limit(limit)
        .related('ticket');
    }
  ),

  // @deprecated
  ticketById: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.tickets
      .where('id', ticketId)
      .related('project')
      .related('tags')
      .related('assignments')
      .related('referencesOut', (ref) => ref.related('targetTicket'))
      .related('referencesIn', (ref) => ref.related('sourceTicket'))
      .related('entity')
      .related('conversation')
      .related('stageEtaEntries')
      .related('ticketStageRequests', a => a.related('form'))
      .one();
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
      .related('referencesOut', (ref) => ref.related('targetTicket'))
      .related('referencesIn', (ref) => ref.related('sourceTicket'))
      .related('entity')
      .related('conversation')
      .related('stageEtaEntries')
      .related('ticketStageRequests', a => a.related('form'))
      .one();
  }),
  // @deprecated
  ticketDetailsById: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.tickets
      .where('id', ticketId)
      .related('project')
      .related('tags')
      .related('assignments')
      .related('referencesOut', (ref) => ref.related('targetTicket'))
      .related('referencesIn', (ref) => ref.related('sourceTicket'))
      .related('entity')
      .related('conversation')
      .related('stageEtaEntries')
      .related('rcas', rcaQuery => rcaQuery.orderBy('createdAt', 'desc').limit(1))
      .related('ticketStageRequests', a => a.related('form'))
      .one();
  }),
  ticketDetailsByIdV2: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.tickets
      .where('id', ticketId)
      .related('project')
      .related('tagMappings')
      .related('assignments', a => a.related('role'))
      .related('referencesOut', (ref) => ref.related('targetTicket'))
      .related('referencesIn', (ref) => ref.related('sourceTicket'))
      .related('entity')
      .related('conversation')
      .related('stageEtaEntries')
      .related('rcas', rcaQuery => rcaQuery.orderBy('createdAt', 'desc').limit(1))
      .related('ticketStageRequests', a => a.related('form'))
      .one();
  }),
  // @deprecated
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
  // @deprecated
  ticketByXyneIdV2: defineQuery(z.object({ xyneId: z.string(), workspaceId: z.string() }), ({ args: { xyneId, workspaceId } }) => {
    return zql.tickets
      .where('xyneId', xyneId)
      .where('workspaceId', workspaceId)
      .related('project')
      .related('tags')
      .related('referencesOut', (ref) => ref.related('targetTicket'))
      .related('referencesIn', (ref) => ref.related('sourceTicket'))
      .related('entity')
      .related('conversation')
      .one();
  }),
  ticketByXyneIdV3: defineQuery(z.object({ xyneId: z.string(), workspaceId: z.string() }), ({ args: { xyneId, workspaceId } }) => {
    return zql.tickets
      .where('xyneId', xyneId)
      .where('workspaceId', workspaceId)
      .related('project')
      .related('tagMappings')
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

  automationsList: defineQuery(() => {
    return zql.workflows
      .where('workflowType', 'Automations')
      .orderBy('createdAt', 'desc');
  }),
  automationById: defineQuery(z.object({ id: z.string() }), ({ args: { id } }) => {
    return zql.workflows
      .where('id', id)
      .where('workflowType', 'Automations')
      .one();
  }),
  subTicketsForTicket: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) => {
    return zql.ticket_sub_ticket_mappings
      .where('ticketId', ticketId)
      .related('subTicket', (subTicketQuery) =>
        subTicketQuery.related('conversation').related('mappedTicket')
      )
      .orderBy('id', 'asc');
  }),
  subTicketMappingsForTickets: defineQuery(
    z.object({ ticketIds: z.array(z.string()) }),
    ({ args: { ticketIds } }) => {
      return zql.ticket_sub_ticket_mappings
        .where(helpers => helpers.cmp('ticketId', 'IN', ticketIds))
        .related('subTicket', (subTicketQuery) =>
          subTicketQuery.related('conversation').related('mappedTicket')
        )
        .orderBy('id', 'asc');
    }
  ),

  subTicketsByMappedTicketId: defineQuery(
    z.object({ mappedTicketId: z.string() }),
    ({ args: { mappedTicketId } }) => {
      return zql.sub_tickets.where('mappedTicketId', mappedTicketId).related('ticketMappings');
    }
  ),

  subTicketByMappedTicketId: defineQuery(
    z.object({ mappedTicketId: z.string() }),
    ({ args: { mappedTicketId } }) => {
      return zql.sub_tickets.where('mappedTicketId', mappedTicketId).one();
    }
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
    return zql.channels.whereExists('participantsStatus', (p) =>
      p.where('isClosed', false).where('isDeleted', false).where('userId', ctx.userID)
    ).related('channelStats');
  }),
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

  channelStats: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.channel_stats.where('channelId', channelId).one();
    },
  ),
  channelStatsByIds: defineQuery(
    z.object({ channelIds: z.array(z.string()) }),
    ({ args: { channelIds } }) => {
      return zql.channel_stats.where(helpers =>
        helpers.or(...channelIds.map(id => helpers.cmp('channelId', '=', id))),
      );
    },
  ),
  channelParticipants: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.channel_participants.where('channelId', channelId);
    }
  ),
  myChannelParticipations: defineQuery(
    z.object({}),
    ({ ctx }) => {
      return zql.channel_participants.where('userId', ctx.userID).where('role', ChannelRole.ADMIN);
    }
  ),
  // @deprecated Unused by frontend. Use userConversationsPaginatedV2 instead.
  userConversationsPaginated: defineQuery(
    z.object({
      userId: z.string(),
      limit: z.number(),
      start: z.object({ lastActivityAt: z.number(), id: z.string() }).nullable(),
    }),
    ({ ctx, args: { limit, start } }) => {
      // Bind to the authenticated caller; the `userId` arg is kept for client
      // compatibility but ignored.
      let query = zql.conversations
        .where('replyCount', '>', 0)
        .whereExists('participants', (participantsQuery) =>
          participantsQuery.where('userId', ctx.userID)
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
  userConversationsPaginatedV2: defineQuery(
    z.object({
      userId: z.string(),
      limit: z.number(),
      start: z.object({ lastReplyAt: z.number(), id: z.string() }).nullable(),
    }),
    ({ ctx, args: { limit, start } }) => {
      // Bind to the authenticated caller; the `userId` arg is kept for client
      // compatibility but ignored.
      let query = zql.conversation_participants
        .where('userId', ctx.userID)
        .where('lastReplyAt', 'IS NOT', null)
        .where('isSubscribed', true)
        .orderBy('lastReplyAt', 'desc')
        .orderBy('id', 'desc');

      if (start) {
        query = query.start(
          { lastReplyAt: start.lastReplyAt, id: start.id },
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

      return zql.channel_user_status.where('userId', ctx.userID).where('isDeleted', false).where((helpers) => {
        return helpers.cmp('channelId', 'IN', channelIds);
      });
    }
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

      query = query
        .orderBy('updatedAt', isBackward ? 'asc' : 'desc')
        .orderBy('id', isBackward ? 'asc' : 'desc');

      if (args.start) {
        query = query.start(
          { id: args.start.id, updatedAt: args.start.updatedAt },
          { inclusive: !isBackward },
        );
      }

      return includeCurrentUserCanvasStatus(
        query
          .limit(args.limit)
          .related('participants'),
        ctx.userID,
      );
    }
  ),
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
        .where((helpers) => {
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

      return includeCurrentUserCanvasStatus(
        query
          .limit(args.limit)
          .related('participants'),
        ctx.userID,
      );
    }
  ),

  getUsers: defineQuery(
    z.object({ updatedAt: z.number().optional() }).optional(),
    ({ args }) => {
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
    },
  ),

  getUsersV2: defineQuery(z.object({ updatedAt: z.number().optional() }).optional(), ({ args }) => {
    let query = zql.users;
    if (args?.updatedAt !== undefined) {
      query = query.where('updatedAt', '>', args.updatedAt);
    }
    return query
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
    }
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

  recurringSeriesById: defineQuery(
    z.object({ seriesId: z.string() }),
    ({ args: { seriesId } }) => {
      return zql.recurring_call_series.where('id', seriesId).one();
    },
  ),

  userActivities: defineQuery(() => {
    return zql.activities
      .orderBy('updatedAt', 'desc')
      .related('message', (m) =>
        m
          .related('conversation')
          .related('reactions')
          .related('reactionCounts')
          .related('attachments')
      )
      .related('reaction')
      .related('canvas')
      .related('ticket');
  }),
  userActivitiesV2: defineQuery(() => {
    return zql.activities
      .orderBy('updatedAt', 'desc')
      .related('message', (m) => m.related('conversation').related('attachments'))
      .related('reaction')
      .related('canvas')
      .related('call')
      .related('ticket');
  }),

  userMissedCalls: defineQuery(({ ctx }) => {
    return zql.activities
      .where('userId', ctx.userID)
      .where('actorAction', 'missed_call')
      .where('isRead', false);
  }),

  userUnreadActivities: defineQuery(() => {
    return zql.activities.where('isRead', false).orderBy('updatedAt', 'desc').related('channel');
  }),

  userDrafts: defineQuery(({ ctx }) => {
    return zql.draft_messages.where('userId', ctx.userID).related('attachments');
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
          helpers.or(...types.map(type => helpers.cmp('actorAction', '=', type)))
        );
      }

      if (classification && classification.length > 0) {
        query = query.where(helpers =>
          helpers.or(...classification.map(c => helpers.cmp('classification', '=', c)))
        );
      }

      query = query.orderBy('updatedAt', 'desc').orderBy('id', 'desc');

      if (start) {
        query = query.start({ id: start.id, updatedAt: start.updatedAt }, { inclusive: false });
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
        .related('canvas')
        .related('ticket');
    }
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
          helpers.or(...types.map(type => helpers.cmp('actorAction', '=', type)))
        );
      }

      if (classification && classification.length > 0) {
        query = query.where(helpers =>
          helpers.or(...classification.map(c => helpers.cmp('classification', '=', c)))
        );
      }

      if (isRead !== undefined) {
        query = query.where('isRead', isRead);
      }

      // Actor kind lives on users.userType, not on the activity row, so this has to
      // reach through the `actor` relationship. Must stay in step with the client
      // definition in packages/shared/src/zero/queries.ts — this is the copy the
      // server actually executes via handleQueryRequest.
      if (actorTypes && actorTypes.length > 0) {
        query = query.whereExists('actor', (actor: any) =>
          actor.where('userType', 'IN', actorTypes)
        );
      }

      query = query.orderBy('updatedAt', 'desc').orderBy('id', 'desc');

      if (start) {
        query = query.start({ id: start.id, updatedAt: start.updatedAt }, { inclusive: false });
      }

      return query
        .limit(limit)
        .related('message', (m) => m.related('conversation').related('attachments'))
        .related('reaction')
        .related('canvas')
        .related('call')
        .related('ticket');
    }
  ),

  // @deprecated Kept for backward compatibility with older clients.
  // New clients use isThreadActivity field from userUnreadActivities instead.
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
  getMessageForActivityV2: defineQuery(
    z.object({ messageId: z.string() }),
    ({ args: { messageId } }) => {
      return zql.messages
        .where('messageId', messageId)
        .related('conversation')
        .related('attachments')
        .one();
    }
  ),

  projectById: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) =>
    zql.projects.where('id', projectId).one()
  ),


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
    }
  ),
  // @deprecated
  ticketsByProject: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) =>
    zql.tickets
      .where('projectId', projectId)
      .where('isArchived', false)
      .where(helpers => helpers.cmp('ticketType', '!=', BaseTicketType.Support))
      .related('tags')
      .orderBy('createdAt', 'desc')
  ),
  // @deprecated
  ticketsByProjectV2: defineQuery(z.object({ projectId: z.string() }), ({ args: { projectId } }) =>
    zql.tickets
      .where('projectId', projectId)
      .where('isArchived', false)
      .where(helpers => helpers.cmp('ticketType', '!=', BaseTicketType.Support))
      .related('tagMappings')
      .orderBy('createdAt', 'desc')
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
        mappingQuery.related('formFields', q => q.related('globalField'))
      );
  }),

  // Full board detail with stages, approvers, formContextMappings, and formFields.
  // Used by KanbanBoardScreen when a single board is selected.
  boardDetailById: defineQuery(z.object({ boardId: z.string() }), ({ args: { boardId } }) => {
    return zql.boards
      .where('id', boardId)
      .related('stages', stagesQuery =>
        stagesQuery
          .orderBy('sequenceNumber', 'asc')
          .related('approvers')
          .related('formContextMappings', fcm => fcm.related('form')),
      )
      .related('formContextMappings', mappingQuery =>
        mappingQuery.related('formFields', q => q.related('globalField')),
      )
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
      .related('formContextMappings', mappingQuery =>
        mappingQuery.related('formFields', q => q.related('globalField')),
      )
      .one();
  }),


  stagesByBoard: defineQuery(z.object({ boardId: z.string() }), ({ args: { boardId } }) =>
    zql.stages
      .where('boardId', boardId)
      .orderBy('sequenceNumber', 'asc')
      .related('approvers')
      .related('formContextMappings')
  ),

  stagesByBoards: defineQuery(
    z.object({ projectId: z.string(), boardType: z.nativeEnum(BoardType).optional() }),
    ({ args: { projectId, boardType } }) => {
      return zql.stages
        .whereExists('board', (b) => {
          const scoped = b.where('projectId', projectId);
          return boardType ? scoped.where('boardType', boardType) : scoped;
        })
        .orderBy('boardId', 'asc')
        .orderBy('sequenceNumber', 'asc');
    },
  ),

  channelCanvasFolders: defineQuery(
    z.object({
      channelId: z.string(),
    }),
    ({ args: { channelId } }) => {
      return zql.canvas_folders.where('channelId', channelId).orderBy('name', 'asc');
    }
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
    }
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
    }
  ),
  
  channelCanvasesPaginated: defineQuery(
    z.object({
      channelId: z.string(),
      includeQuartoDocs: z.boolean().optional(),
      includeArchived: z.boolean().optional(),
      onlyArchived: z.boolean().optional(),
      limit: z.number(),
      start: z.object({ id: z.string(), updatedAt: z.number() }).nullable(),
    }),
    ({ ctx, args: { channelId, includeQuartoDocs, includeArchived, onlyArchived, limit, start } }) => {
      let query = zql.canvases.where('channelId', channelId);

      if (!includeQuartoDocs) {
        query = query.where('docType', DocType.Canvas);
      }

      query = applyArchiveFilter(query, { includeArchived, onlyArchived });

      query = applyCanvasVisibilityQueryFilter(query, ctx.userID);

      query = query.orderBy('updatedAt', 'desc').orderBy('id', 'desc');

      if (start) {
        query = query.start({ updatedAt: start.updatedAt, id: start.id }, { inclusive: false });
      }

      return includeCurrentUserCanvasStatus(
        query.limit(limit).related('participants').related('channel'),
        ctx.userID,
      );
    }
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
    }
  ),

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

  getCanvas: defineQuery(z.object({ canvasId: z.string() }), ({ ctx, args: { canvasId } }) => {
    // Backward-compat lookup: match by canonical id, userRepo (Quarto), and
    // the legacy viewAccessId/editAccessId columns so historical chat URLs
    // and stored message metadata that carry those IDs still resolve.
    // Visibility is still gated by applyCanvasVisibilityQueryFilter, and edit
    // privileges still flow through participant checks in the canvas.update
    // mutator — matching editAccessId here does NOT grant edit access.
    return applyCanvasVisibilityQueryFilter(
      zql.canvases
      .where((helpers) => {
        return helpers.or(
          helpers.cmp('id', canvasId),
          helpers.cmp('userRepo', canvasId),
          helpers.cmp('viewAccessId', canvasId),
          helpers.cmp('editAccessId', canvasId)
        );
      })
      .related('participants')
      .related('channel'),
      ctx.userID
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

  ticketActivities: defineQuery(z.object({ ticketId: z.string() }), ({ args: { ticketId } }) =>
    zql.ticket_activities.where('ticketId', ticketId).orderBy('timestamp', 'desc')
  ),
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
        .related('reactionCounts')
        .related('reactions')
        .related('attachments')
        .related('nudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery
            .where(helpers =>
              helpers.or(
                helpers.cmp('userId', '=', ctx.userID),
                helpers.cmp('channelId', '=', channelId),
              )
            )
        );
    }
  ),
  channelAndThreadMessagesV2: defineQuery(
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
        .related('nudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery
            .where(helpers =>
              helpers.or(
                helpers.cmp('userId', '=', ctx.userID),
                helpers.cmp('channelId', '=', channelId),
              )
            )
        );
    }
  ),

  ticketExportsForCurrentUser: defineQuery(() => {
    return zql.ticket_exports.orderBy('createdAt', 'desc').limit(100);
  }),
  getAllProjects: defineQuery(() => {
    return zql.projects
      .where('type', '!=', ProjectType.DM)
      .orderBy('createdAt', 'desc')
      .related('boards');
  }),
  // Projects only (no boards) — boards are lazy-loaded per project in pickers.
  getAllProjectsList: defineQuery(() => {
    return zql.projects.where('type', '!=', ProjectType.DM).orderBy('createdAt', 'desc');
  }),


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
  // Preferred path for resolving channel → boards; consumer falls back to
  // boardsListByProject if the mapping is empty.
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
      return zql.boards
        .where('projectId', projectId)
        .orderBy('createdAt', 'asc');
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
    // Lightweight global board list — only scalar fields, no related data.
    // Use this for dropdowns and pickers that only need board id/name.
    // For full board detail (editing), use boardFullDetailById.
    getAllBoardsList: defineQuery(() => {
      return zql.boards.orderBy('createdAt', 'desc');
    }),

  searchChannelParticipants: defineQuery(
    z.object({ channelId: z.string(), searchQuery: z.string() }),
    ({ args: { channelId, searchQuery } }) => {
      return zql.channel_participants
        .where('channelId', channelId)
        .whereExists('user', (u) =>
          u.where((helpers: any) =>
            helpers.or(
              helpers.cmp('name', 'ILIKE', `%${searchQuery}%`),
              helpers.cmp('displayName', 'ILIKE', `%${searchQuery}%`),
            ),
          ),
        );
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

  // Query for all resources
  getAllResources: defineQuery(() => {
    return zql.resources.orderBy('name', 'asc');
  }),
  // Query for all invitations
  getAllInvitations: defineQuery(() => {
    return zql.invitations.orderBy('createdAt', 'desc');
  }),
  // Query for resource access for a specific user
  getResourceAccessForUser: defineQuery(
    z.object({ userId: z.string() }),
    ({ args: { userId } }) => {
      return zql.resource_access.where('userId', userId);
    },
  ),

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

  getUserGroupMappingsByUserId: defineQuery(({ ctx }) => {
    return zql.user_group_mappings.where('userId', ctx.userID);
  }),

  userBookmarks: defineQuery(() => {
    return zql.bookmarks.where('isDeleted', false).orderBy('createdAt', 'desc');
  }),

  userChannelSections: defineQuery(z.object({}), () => {
    return zql.channel_sections.where('isDeleted', false).orderBy('position', 'asc');
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
        .related('initialMessage', (initialMessageQuery) =>
          initialMessageQuery
            .where(({ or, cmp }) =>
              or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
            )
            .related('reactions')
            .related('reactionCounts')
            .related('attachments')
            .related('nudgeCounts', nudgeCountsQuery =>
              nudgeCountsQuery
                .where(helpers =>
                  helpers.or(
                    helpers.cmp('userId', '=', ctx.userID),
                    helpers.cmp('channelId', '=', channelId),
                  )
                )
            )
        )
        .related('parentMessage', (parentQuery) =>
          parentQuery.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)),
          ),
        )
        .related('participants', (participantQuery) =>
          participantQuery
            .where(helpers =>
              helpers.or(
                helpers.cmp('participationType', ConversationParticipation.AUTHOR),
                helpers.cmp('userId', ctx.userID),
              ),
            )
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
        .related('parentMessage', (parentQuery) =>
          parentQuery.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)),
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
  channelConversationsPaginatedV3: defineQuery(
    z.object({
      channelId: z.string(),
      isMember: z.boolean(),
      limit: z.number(),
      start: z.object({ createdAt: z.number() }).nullable(),
      direction: z.literal('forward').or(z.literal('backward')),
      conversationIds: z.array(z.string()).optional(),
    }),
    ({ ctx, args: { channelId, limit, start, direction, conversationIds } }) => {
      let query = zql.conversations
        .where('channelId', channelId)
        .related('initialMessageAttachments')
        .related('initialMessageNudgeCounts', nudgeCountsQuery =>
          nudgeCountsQuery.where(helpers =>
            helpers.or(
              helpers.cmp('userId', '=', ctx.userID),
              helpers.cmp('channelId', '=', channelId),
            ),
          ),
        );

      if (conversationIds) {
        query = query.where(helpers => helpers.cmp('conversationId', 'IN', conversationIds));
      }

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
              nudgeCountsQuery
                .where(helpers =>
                  helpers.or(
                    helpers.cmp('userId', '=', ctx.userID),
                    helpers.cmp('channelId', '=', channelId),
                  ),
                )
            ),
        )
        .related('parentMessage', (parentQuery) =>
          parentQuery.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)),
          ),
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
        .related('parentMessage', (parentQuery) =>
          parentQuery.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)),
          ),
        )
        .related('ticket')
        .orderBy('createdAt', 'desc')
        .limit(limit);
    },
  ),
  channelLatestMultipleConversationsV3: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean(), limit: z.number(), conversationIds: z.array(z.string()).optional() }),
    ({ ctx, args: { channelId, limit, conversationIds } }) => {
      let query = zql.conversations
        .where('channelId', channelId);
      if (conversationIds) {
        query = query.where(helpers => helpers.cmp('conversationId', 'IN', conversationIds));
      }
      return query
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
        .orderBy('createdAt', 'desc')
        .orderBy('conversationId', 'desc')
        .limit(1)
        .one();
    }
  ),

  /**
   * @deprecated Use getConversationAttachementsV2. The flipped, visibility-only channel exists
   * here materializes every public channel on hydration and can wedge a syncer worker (Aug 2026
   * WAL-starvation incidents). Kept only for already-deployed clients; do not add call sites.
   */
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
      let query = zql.message_attachments.whereExists('conversation', (conv) =>
        conv.where('channelId', channelId)
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
    z.object({ channelId: z.string(), isMember: z.boolean() }),
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
        .related('parentMessage', (parentQuery) =>
          parentQuery.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)),
          ),
        )
        .related('ticket')
        .related('participants', (participantQuery) =>
          participantQuery
            .where('participationType', ConversationParticipation.AUTHOR)
            .orderBy('joinedAt', 'asc')
        );
    }
  ),
  getPinnedMessegesV2: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean() }),
    ({ ctx, args: { channelId } }) => {
      return zql.conversations
        .where('channelId', channelId)
        .where('pinned', true)
        .related('initialMessage', (initialMessageQuery) =>
          initialMessageQuery
            .where(({ or, cmp }) =>
              or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID))
            )
            .related('attachments')
        )
        .related('parentMessage', (parentQuery) =>
          parentQuery.where(({ or, cmp }) =>
            or(cmp('visibleTo', 'IS', null), cmp('visibleTo', '=', ctx.userID)),
          ),
        )
        .related('ticket')
        .related('participants', (participantQuery) =>
          participantQuery
            .where('participationType', ConversationParticipation.AUTHOR)
            .orderBy('joinedAt', 'asc')
        );
    }
  ),

  channelLatestMessage: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean()}),
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
  channelLatestMessageV2: defineQuery(
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
            .related('attachments')
        )
        .orderBy('createdAt', 'desc')
        .one();
    }
  ),

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
      .where((helpers) => {
        return helpers.exists('participantsStatus', (p) => {
          return p.where('isClosed', false).where('isDeleted', false).where('userId', ctx.userID);
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
  projectTagsByProjectId: defineQuery(
    z.object({ projectId: z.string() }),
    ({ args: { projectId } }) => {
      return zql.project_tags
        .where('projectId', projectId)
        .orderBy('name', 'asc');
    },
  ),

  // KEEP IN SYNC with shared/src/zero/queries.ts conversation label queries.
  conversationLabelsByChannelId: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) => {
      return zql.conversation_labels
        .where('channelId', channelId)
        .orderBy('name', 'asc');
    },
  ),

  conversationLabelsByChannelIdV2: defineQuery(
    z.object({ channelId: z.string(), isMember: z.boolean() }),
    ({ args: { channelId } }) => {
      return zql.conversation_labels
        .where('channelId', channelId)
        .orderBy('name', 'asc');
    },
  ),
  // @deprecated Use conversationLabelMappingsByConversationIdV2 when channel membership is known.
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
  //@deprecated
  conversationLabelMappingsByLabelId: defineQuery(
    z.object({ labelId: z.string() }),
    ({ args: { labelId } }) => {
      return zql.conversation_label_mappings
        .where('labelId', labelId)
        .related('conversation', c => c.related('ticket'))
        .orderBy('createdAt', 'desc');
    },
  ),

  // KEEP IN SYNC with shared/src/zero/queries.ts mailbox queries.
  myTicketMailbox: defineQuery(
    z.object({ ticketId: z.string() }),
    ({ args: { ticketId } }) => {
      return zql.ticket_user_mailbox.where('ticketId', ticketId);
    },
  ),
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

  getUserWorkloadMappings: defineQuery(
    z.object({ userGroupId: z.string() }),
    ({ args: { userGroupId } }) => {
      return zql.user_workload_mappings.where('userGroupId', userGroupId);
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
  // Query for assignment states across several user groups at once
  getUserAssignmentStatesByGroupIds: defineQuery(
    z.object({ userGroupIds: z.array(z.string()) }),
    ({ args: { userGroupIds } }) => {
      return zql.user_assignment_states.where('userGroupId', 'IN', userGroupIds);
    }
  ),

  // Repository queries
  getAllRepos: defineQuery(() => {
    return zql.repos.orderBy('name', 'asc');
  }),
  /** SDLC hubs the viewer can reach, each with the repositories it covers. */
  getSdlcChannels: defineQuery(({ ctx }) =>
    zql.channels
      .where('type', ChannelType.SDLC)
      .where('isArchived', false)
      // The channels ACL lets workspace admins and public channels through; a hub
      // is only usable by its participants, and every write re-checks that.
      .whereExists('participants', participant => participant.where('userId', ctx.userID))
      .related('sdlcEntityLinks', link =>
        link
          .where('relationType', SDLC_MEMBERSHIP_RELATION)
          .related('repo', repo => repo.related('project')),
      )
      .orderBy('name', 'asc'),
  ),
  getSdlcChannelById: defineQuery(z.object({ channelId: z.string() }), ({ args: { channelId } }) =>
    zql.channels
      .where('id', channelId)
      .where('type', ChannelType.SDLC)
      .related('participants')
      .related('channelStats')
      .related('canvasFolders', folder =>
        folder.related('canvases', canvas => canvas.related('sdlcArtifact')),
      )
      .related('sdlcEntityLinks', link =>
        link
          .where('relationType', SDLC_MEMBERSHIP_RELATION)
          .related('repo', repo => repo.related('project').related('setupExecution')),
      )
      .one(),
  ),
  /** A hub's tracks. Tracks carry no scope column; the CHANNEL -> TRACK edge places them. */
  getSdlcTracks: defineQuery(z.object({ channelId: z.string() }), ({ args: { channelId } }) =>
    zql.sdlc_tracks
      .whereExists('sdlcEntityLinks', link =>
        link
          .where('channelId', channelId)
          .where('relationType', SDLC_TRACK_MEMBERSHIP_RELATION),
      )
      .orderBy('createdAt', 'asc'),
  ),
  getSdlcRepoById: defineQuery(z.object({ repoId: z.string() }), ({ args: { repoId } }) =>
    zql.repos
      .where('id', repoId)
      .where('projectId', 'IS NOT', null)
      .related('project')
      .related('setupExecution')
      .one(),
  ),
  /**
     * The content graph for a hub. Structural edges (repository and track membership)
     * share this table — grep SDLC_STRUCTURAL_RELATIONS for every exclusion.
     */
  getSdlcLinks: defineQuery(z.object({ channelId: z.string() }), ({ args: { channelId } }) =>
    zql.sdlc_entity_links
      .where('channelId', channelId)
      .where(helpers => helpers.cmp('relationType', 'NOT IN', [...SDLC_STRUCTURAL_RELATIONS]))
      .orderBy('createdAt', 'asc'),
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
  sdlcTicketsByChannel: defineQuery(
    z.object({ channelId: z.string() }),
    ({ args: { channelId } }) =>
      zql.tickets
        .where('channelId', channelId)
        .where('isArchived', false)
        .where('rootId', 'IS', null)
        .where(helpers =>
          helpers.or(
            helpers.cmp('ticketType', 'IS', null),
            helpers.cmp('ticketType', '!=', BaseTicketType.Support),
          ),
        ),
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
      .orderBy('createdAt', 'desc')
  }),
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
    }
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
    }
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
    }
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
    }
  ),
    // Query to get all form entity values for tickets (cached for reuse across all boards)
  getAllFormEntityValues: defineQuery(() => {
    return zql.form_entity_values.where('entityType', FormEntityType.TICKET).related('formField').related('globalField');
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
  // RCA Queries
  allRCAsPaginated: defineQuery(
    z.object({
      limit: z.number(),
      start: z.object({ createdAt: z.number(), id: z.string() }).nullable(),
    }),
    ({ args: { limit, start } }) => {
      let query = zql.rcas
        .orderBy('createdAt', 'desc')
        .related('ticket');

      if (start) {
        query = query.start(
          { createdAt: start.createdAt, id: start.id },
          { inclusive: false }
        );
      }

      return query.limit(limit);
    }
  ),

  rcaById: defineQuery(z.object({ rcaId: z.string() }), ({ args: { rcaId } }) => {
    return zql.rcas
      .where('id', rcaId)
      .related('impacts')
      .related('coes')
      .related('ticket')
      .one();
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
      return zql.release_attributions
        .where('ticketId', ticketId)
        .orderBy('createdAt', 'desc');
    },
  ),

  // ART rows scoped to a release ticket — joined through the per-app SubTicket mapping.
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
            .related('pullRequests', pullRequests => pullRequests.orderBy('date', 'desc'));
          if (includeColumnData) {
            devTicket = devTicket.related('workflows').related('tags').related('formEntityValues');
          }
          return devTicket;
        })
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc');

      if (start) {
        query = query.start({ createdAt: start.createdAt, id: start.id }, { inclusive: false });
      }

      return limit !== undefined ? query.limit(limit) : query;
    },
  ),

  // Per-instance release change anchors (env + migration) scoped to a release ticket.
  releaseChangesByReleaseId: defineQuery(
    z.object({ releaseId: z.string().min(1) }),
    ({ args: { releaseId } }) => {
      return zql.release_change_types
        .where('releaseId', releaseId)
        .related('application')
        .orderBy('createdAt', 'desc');
    },
  ),

  // Audit-log feed for a release ticket, powering the Timeline tab on the
  // Release Detail screen. Newest-first, with id as tiebreaker for stable order.
  // NOTE: this MUST also exist in shared/src/zero/queries.ts — the dashboard
  // imports from shared, the zero-cache forwards queries to this module.
  // Bounded: the audit log grows on every re-run. Keep in sync with the shared copy.
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

  // Form values for env + migration change instances under a release ticket.
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

  // Stable single-arg query: keying on the project avoids both the
  // boards->applications request waterfall and re-registering a new IN-list
  // view on zero-cache every time the board set changes.
  applicationsByProjectId: defineQuery(
    z.object({ projectId: z.string() }),
    ({ args: { projectId } }) => {
      return zql.applications.where('projectId', projectId);
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
      // Exclude Release and Support tickets from regular search
      // Release tickets are managed separately, Support tickets are handled by IT Support Workflow
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

  // Links queries
  channelLinks: defineQuery(
    z.object({ channelId: z.string() }),
    ({ ctx, args: { channelId } }) => {
      return zql.links
        .where('channelId', channelId)
        .where(({ or, cmp, and, exists }) =>
          or(
            // DEFAULT visibility - visible to members of the link's channel only.
            and(
              cmp('visibility', '=', LinkVisibility.DEFAULT),
              exists('channel', (ch) =>
                ch.where(({ or: or2, cmp: cmp2, exists: exists2 }) =>
                  or2(
                    cmp2('visibility', '=', ChannelVisibility.PUBLIC),
                    exists2('participants', (p) => p.where('userId', ctx.userID))
                  )
                )
              )
            ),
            // PERSONAL visibility - only visible to creator
            and(
              cmp('visibility', '=', LinkVisibility.PERSONAL),
              cmp('createdBy', '=', ctx.userID)
            ),
            // PERSONAL visibility - shared with current user
            and(
              cmp('visibility', '=', LinkVisibility.PERSONAL),
              exists('sharedWith', sw => sw.where('userId', '=', ctx.userID))
            )
          )
        )
        .related('sharedWith')
        .orderBy('createdAt', 'desc');
    }
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

  // Stage transitions (with approvers) for a board — used by NON_LINEAR board config and the
  // drag/drop form gate. Mirrors shared queries.
  getStageTransitionsByBoardId: defineQuery(
    z.object({ boardId: z.string() }),
    ({ args: { boardId } }) => {
      return zql.stage_transitions.where('boardId', boardId).related('transitionApprovers');
    },
  ),

  // Stage transitions for multiple boards — used by automation form-field picker to resolve
  // which stage forms belong to which board.
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

  // Root collections, optionally filtered by scope. Pass { scopeType, scopeId } to
  // scope to a channel; pass {} for ALL collections the user can access (Ask AI
  // picker from any chat). Access is enforced by the collections ACL either way.
  scopedCollections: defineQuery(
    z.object({ scopeType: z.string().optional(), scopeId: z.string().optional() }),
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
        helpers.or(
          helpers.cmp('visibleTo', 'IS', null),
          helpers.cmp('visibleTo', '=', ctx.userID),
        ),
      );

      return query.orderBy('createdAt', 'asc');
    },
  ),


  // Recap Queries
  /** @deprecated Use channelRecaps instead */
  channelDailyRecaps: defineQuery(
    z.object({
      channelIds: z.array(z.string()),
      recapDate: z.number(),
    }),
    ({ ctx, args: { channelIds, recapDate } }) => {
      if (channelIds.length === 0) {
        return zql.channel_daily_recaps.limit(0);
      }

      return zql.channel_daily_recaps
        .where('recapDate', recapDate)
        .where((helpers) =>
          helpers.or(...channelIds.map((id) => helpers.cmp('channelId', id)))
        )
        // Fetch both base recaps (userId IS NULL) and this user's custom recaps
        .where((helpers) =>
          helpers.or(
            helpers.cmp('userId', 'IS', null),
            helpers.cmp('userId', '=', ctx.userID)
          )
        );
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
      const effectiveStates = states && states.length > 0
        ? states.map(s => s as NudgeState)
        : [NudgeState.ACTIVE];

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

  // Org view — ORG-scoped apps for the given org (orgId provided by the client).
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
        .where(({ and, cmp }) => and(cmp('scope', 'ORG'), cmp('orgId', orgId)))
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
        .where('scope', 'GLOBAL')
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc');
      if (start) {
        query = query.start({ createdAt: start.createdAt, id: start.id }, { inclusive: false });
      }
      // No `installations` relation — see getOrgApps. Cross-org install rows must not leak.
      return query.limit(limit);
    },
  ),

  userEmailSignatures: defineQuery(({ ctx }) => {
    return zql.email_signatures.where('userId', ctx.userID).orderBy('name', 'asc');
  }),

  // Get workspace by ID
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
  availableOrganizations: defineQuery(
    z.object({}),
    () => {
      return zql.organizations
        .where('status', Status.ACTIVE)
        .orderBy('name', 'asc');
    },
  ),

  // Get active members of an organisation
  getOrgMembers: defineQuery(
    z.object({ orgId: z.string() }),
    ({ args: { orgId } }) => {
      return zql.org_members
        .where('orgId', orgId)
        .where('leftAt', 'IS', null)
        .orderBy('joinedAt', 'asc');
    },
  ),

  getOrgMemberById: defineQuery(
    z.object({ memberId: z.string() }),
    ({ args: { memberId } }) => {
      return zql.org_members.where('memberId', memberId).one();
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
  /** All delayed messages for the current user that are still pending */
  userDelayedMessages: defineQuery(({ ctx }) => {
    return zql.delayed_messages
      .where('senderId', ctx.userID)
      .where('status', DelayedMessageStatus.PENDING)
      .orderBy('scheduledFor', 'asc')
      .related('attachments');
  }),

  /** Paginated delayed messages for the current user */
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
}) as unknown as QueryRegistry<Record<string, AnyQueryDefinition>, typeof schema>;
