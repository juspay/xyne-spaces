import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { createTicketWithConversation } from '../core/ticketutils';
import { Prisma } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { ticketService } from '@/services/ticketService';
import { ticketAssignmentService, primaryUserIdOf } from '@/services/ticketAssignmentService';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';
import { DatabaseClient } from '@/database/client';
import type { BoardMetadata } from '@xyne/shared';
import {
  resolveParentOption,
  TicketPriority,
  TicketStatusV2,
  MessageDirection,
  ExternalEntityType,
  EmailType,
  DeskType,
  isDeskChannelType,
} from '@xyne/shared';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { emitEventToWorkspaceApps } from '../core/eventSubscriptionUtils';
import { AppEventType, AdditionalFormFieldUpdatedPayload, BaseAppEvent } from '../types';
import { emailService } from '@/services/emailService';
import { uploadFiles } from '@/services/fileUploadService';
import { config } from '@/config/env';
import { buildEmailTicketAcknowledgmentBody } from '../core/emailUtils';
import { extractEmailAddress } from '@/utils/email';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { scopeExternalMessageIdToSource } from '@/integrations/core/deskSources';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { createTicketCustomFieldActivity } from '@/services/ticketCustomFieldActivityService';

import { resolveChannelId } from '../utils/channelUtils';
import { decodeCursor, paginateResults } from '../core/paginationUtils';
import type { MerchantTicketListItem } from '../types';
import { validateChannelIdsAccess } from '../middelware/channelValidation';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { generateKeyBetween } from 'fractional-indexing';
import { resolveFormFieldDefinitionsForForm } from '@/utils/fieldDefinition';
import type { TicketCustomFormData } from '@/database/repositories/formsRepository';
import {
  fetchTicketInfoByIdentifier,
  normalizeCustomFieldValue,
  normalizeHistoryLimit,
} from './ticketController.helpers';
import { buildTicketFilterWhere, type TicketFilters } from './ticketFilters';
import {
  buildCustomFieldWritePayload,
  buildPartialCustomFieldWritePayload,
  resolveSavedParentValues,
  syncCustomFieldValues,
  validateUserCustomFieldReferences,
  type CustomFieldWritePayload,
} from '@/services/ticketCustomFieldService';
import { emitTicketUpdated } from '@/automations/triggers/ticket-updated.trigger';
import { syncStageOverdueFlag } from '@/services/tickets/syncStageOverdueFlag';

const externalSourceRepo = new ExternalSourceRepository();
const externalMessageRepo = new ExternalMessageRepository();
const emailChannelPreferenceRepo = new EmailChannelPreferenceRepository();
const appsFilesBaseUrl = `${config.backendUrl.replace(/\/$/, '')}/api/apps/files`;

const prismaClient = DatabaseClient.getInstance();

const CreateTicketBodySchema = z.object({
  title: z.string().min(1, 'Title is required').trim(),
  description: z.string().min(1, 'Description is required').trim(),
  projectId: z.string().min(1, 'Project ID is required').trim(),
  boardId: z.string().min(1, 'Board ID is required').trim(),
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  text: z.string().trim().optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedToEmail: z.string().email('Invalid email format').trim().optional(),
  assignedUserGroupAlias: z.string().trim().optional(),
  stageName: z.string().trim().optional(),
  eta: z.string().datetime({ message: 'ETA must be a valid ISO 8601 date string' }).optional(),
  ticketType: z.string().trim().optional(),
  dynamicFields: z.record(z.unknown()).optional(),
}).refine(
  data => !!data.channelId || !!data.channelName,
  { message: 'Either channelId or channelName is required', path: ['channelId'] }
).refine(
  data => !data.eta || new Date(data.eta) > new Date(),
  { message: 'ETA must be a future date', path: ['eta'] }
);

const UpdateTicketBodySchema = z.object({
  ticketId: z.string().min(1, 'Ticket ID is required').trim(),
  channelId: z.string().trim().optional(),
  channelName: z.string().trim().optional(),
  conversationId: z.string().trim().optional(),
  assigneeId: z.string().trim().nullable().optional(),
  assignedToEmail: z.string().email('Invalid email format').trim().optional(),
  stageName: z.string().trim().optional(),
  statusV2: z.nativeEnum(TicketStatusV2).optional(),
  groupId: z.string().trim().nullable().optional(),
  assignedUserGroupAlias: z.string().trim().optional(),
  title: z.string().min(1, 'Title cannot be empty').trim().optional(),
  description: z.string().min(1, 'Description cannot be empty').trim().optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  eta: z.union([z.string().datetime({ message: 'ETA must be a valid ISO 8601 date string' }), z.null()]).optional(),
  ticketType: z.string().trim().optional(),
  boardId: z.string().min(1, 'Board ID cannot be empty').trim().optional(),
  isArchived: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1, 'Tags cannot be empty')).optional(),
  dynamicFields: z.record(z.unknown()).optional(),
}).refine(
  data => !!data.channelId || !!data.channelName || !!data.conversationId,
  { message: 'Either channelId, channelName, or conversationId is required', path: ['channelId'] }
).refine(
  data => !!(
    data.assigneeId || data.assignedToEmail || data.stageName || data.groupId ||
    data.title || data.description || data.priority || data.eta ||
    data.ticketType || data.statusV2 || data.boardId || data.assignedUserGroupAlias ||
    data.isArchived !== undefined || data.tags || data.dynamicFields
  ),
  { message: 'At least one field to update is required', path: ['assigneeId'] }
).refine(
  data => !(data.assigneeId && data.assignedToEmail),
  { message: 'Provide either assigneeId or assignedToEmail, not both', path: ['assigneeId'] }
).refine(
  data => !data.eta || data.eta === null || new Date(data.eta) > new Date(),
  { message: 'ETA must be a future date', path: ['eta'] }
).refine(
  data => !(data.boardId && data.stageName),
  { message: 'boardId and stageName cannot be updated in the same request', path: ['boardId'] }
);

const CreateEmailTicketBodySchema = z.object({
  channelId: z.string().min(1, 'channelId is required').trim(),
  subject: z.string().min(1, 'subject is required').trim(),
  body: z.string().min(1, 'body is required').trim(),
  senderEmail: z.string().email('senderEmail must be a valid email').trim(),
  boardId: z.string().min(1, 'boardId must not be empty').trim().optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedToEmail: z.string().email('Invalid email format').trim().optional(),
  assignedUserGroupAlias: z.string().trim().optional(),
  stageName: z.string().trim().optional(),
  ticketType: z.string().trim().optional(),
});

const AppDeskInboundBodySchema = z.object({
  channelId: z.string().min(1, 'channelId is required').trim(),
  threadId: z.string().min(1, 'threadId is required').trim(),
  externalId: z.string().min(1).trim().optional(),
  subject: z.string().min(1, 'subject is required').trim(),
  body: z.string().trim().optional(),
  senderName: z.string().trim().optional(),
  senderEmail: z.string().email('senderEmail must be a valid email when provided').trim().optional(),
  additionalFormFields: z.record(z.unknown()).optional(),
});

const ListBySenderQuerySchema = z.object({
  channelIds: z.array(z.string().min(1, 'channelId must not be empty').trim()).min(1, {
    message: 'At least one channelId is required (channelId, repeated channelId, or channelIds)',
  }),
  senderEmail: z.string().email('senderEmail must be a valid email').trim(),
  limit: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
});

/**
 * Coerce a scalar-or-array query value into an array so both
 * `field: "a"` and `field: ["a","b"]` are accepted.
 */
const toArrayFilter = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    value => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(schema),
  );

/**
 * Optional filter block for POST /list/search. Covers core ticket columns and
 * related-table data (tags via ticket_tags). Custom form fields are matched
 * separately via the top-level `customFields` map. Every list field accepts a
 * scalar or an array.
 */
const TicketFiltersSchema = z
  .object({
    statusV2: toArrayFilter(z.nativeEnum(TicketStatusV2)).optional(),
    priority: toArrayFilter(z.nativeEnum(TicketPriority)).optional(),
    stageName: toArrayFilter(z.string().trim().min(1)).optional(),
    ticketType: toArrayFilter(z.string().trim().min(1)).optional(),
    assignedTo: toArrayFilter(z.string().trim().min(1)).optional(),
    createdBy: toArrayFilter(z.string().trim().min(1)).optional(),
    userGroupId: toArrayFilter(z.string().trim().min(1)).optional(),
    tags: toArrayFilter(z.string().trim().min(1)).optional(),
    isArchived: z.boolean().optional(),
    createdAfter: z.string().datetime({ message: 'createdAfter must be an ISO 8601 date string' }).optional(),
    createdBefore: z.string().datetime({ message: 'createdBefore must be an ISO 8601 date string' }).optional(),
  })
  .strict();

const SearchTicketsBodySchema = z.object({
  channelId: z.string().min(1, 'channelId must not be empty').trim().optional(),
  boardIds: z.array(z.string().min(1, 'boardIds must not contain empty values').trim()).min(1, 'boardIds must not be empty').optional(),
  projectId: z.string().min(1, 'projectId must not be empty').trim().optional(),
  senderEmail: z.string().email('senderEmail must be a valid email').trim().optional(),
  senderName: z.string().trim().min(1, 'senderName must not be empty').optional(),
  filters: TicketFiltersSchema.optional(),
  customFields: z.record(z.unknown()).optional(),
  includeCustomFields: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
}).superRefine((data, ctx) => {
  // Require at least one scope (channelId / boardIds / projectId).
  const hasChannel = typeof data.channelId === 'string' && data.channelId.length > 0;
  const hasBoards = Array.isArray(data.boardIds) && data.boardIds.length > 0;
  const hasProject = typeof data.projectId === 'string' && data.projectId.length > 0;
  if (!hasChannel && !hasBoards && !hasProject) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['channelId'],
      message: 'At least one of channelId, boardIds, or projectId is required',
    });
  }
  // customFields is an expensive post-filter — require a board/project scope to bound it.
  if (data.customFields && Object.keys(data.customFields).length > 0 && !hasBoards && !hasProject) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['boardIds'],
      message: 'boardIds or projectId is required when customFields are provided',
    });
  }
});

const TicketConversationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

function parseListBySenderChannelIds(query: Request['query']): string[] {
  const ids = new Set<string>();

  const channelIdsParam = query.channelIds;
  if (typeof channelIdsParam === 'string' && channelIdsParam.trim()) {
    for (const part of channelIdsParam.split(',')) {
      const trimmed = part.trim();
      if (trimmed) ids.add(trimmed);
    }
  }

  const channelIdParam = query.channelId;
  if (Array.isArray(channelIdParam)) {
    for (const value of channelIdParam) {
      if (typeof value === 'string' && value.trim()) ids.add(value.trim());
    }
  } else if (typeof channelIdParam === 'string' && channelIdParam.trim()) {
    ids.add(channelIdParam.trim());
  }

  return [...ids];
}

interface MerchantTicketsListCursor {
  id: string;
  createdAt: number;
}

interface TicketConversationCursor {
  id: string;
  createdAt: number;
}
const replaceTicketTags = async (ticketId: string, tags: string[]): Promise<void> => {
  const normalizedTags = Array.from(new Set(tags.map(tag => tag.trim()).filter(Boolean)));
  const ticket = await prismaClient.ticket.findUnique({
    where: { id: ticketId },
    select: { projectId: true, workspaceId: true },
  });
  if (!ticket) return;

  const existingMappings = await prismaClient.ticketTagMapping.findMany({
    where: { ticketId },
    select: { tagName: true },
  });

  const existingTagNames = new Set(existingMappings.map(tag => tag.tagName));
  const tagsToAdd = normalizedTags.filter(tag => !existingTagNames.has(tag));
  const tagsToRemove = existingMappings
    .map(tag => tag.tagName)
    .filter(tagName => !normalizedTags.includes(tagName));

  if (tagsToAdd.length > 0) {
    if (ticket?.projectId) {
      await prismaClient.projectTag.createMany({
        data: tagsToAdd.map(name => ({ name, projectId: ticket.projectId!, workspaceId: ticket.workspaceId })),
        skipDuplicates: true,
      });

      const projectTags = await prismaClient.projectTag.findMany({
        where: {
          projectId: ticket.projectId,
          name: { in: tagsToAdd },
        },
        select: { id: true, name: true },
      });
      const tagIdByName = new Map(projectTags.map(tag => [tag.name, tag.id]));

      await prismaClient.ticketTagMapping.createMany({
        data: tagsToAdd
          .map(name => {
            const tagId = tagIdByName.get(name);
            if (!tagId) return null;
            return { ticketId, tagId, tagName: name, workspaceId: ticket.workspaceId };
          })
          .filter((value): value is { ticketId: string; tagId: string; tagName: string; workspaceId: string } => value !== null),
        skipDuplicates: true,
      });
    }

    // Mirror to legacy table while downstream consumers are still being migrated.
    await prismaClient.ticketTag.createMany({
      data: tagsToAdd.map(name => ({ ticketId, name, workspaceId: ticket.workspaceId })),
      skipDuplicates: true,
    });
  }

  if (tagsToRemove.length > 0) {
    await prismaClient.ticketTagMapping.deleteMany({
      where: {
        ticketId,
        tagName: { in: tagsToRemove },
      },
    });

    await prismaClient.ticketTag.deleteMany({
      where: {
        ticketId,
        name: { in: tagsToRemove },
      },
    });
  }
};

const transferTicketToBoard = async (params: {
  ticketId: string;
  targetBoardId: string;
  updatedBy: string;
}): Promise<void> => {
  const { ticketId, targetBoardId, updatedBy } = params;
  const now = new Date();

  await prismaClient.$transaction(async tx => {
    const newBoardStages = await tx.stage.findMany({
      where: { boardId: targetBoardId },
      orderBy: { sequenceNumber: 'asc' },
    });

    if (newBoardStages.length === 0) {
      throw new Error(`No stages found for board ${targetBoardId}`);
    }

    const firstStage = newBoardStages[0];
    const totalEtaHours = newBoardStages.reduce((sum, stage) => sum + (stage.eta || 0), 0);
    const ticketEta = totalEtaHours > 0 ? calculateETADeadline(now, totalEtaHours) : null;

    const firstTicketInStage = await tx.ticket.findFirst({
      where: {
        boardId: targetBoardId,
        stageName: firstStage.name,
        kanbanPosition: { not: null },
      },
      orderBy: { kanbanPosition: 'asc' },
      select: { kanbanPosition: true },
    });

    let kanbanPosition: string;
    try {
      kanbanPosition = generateKeyBetween(null, firstTicketInStage?.kanbanPosition ?? null);
    } catch {
      kanbanPosition = generateKeyBetween(null, null);
    }

    const updatedTicket = await tx.ticket.update({
      where: { id: ticketId },
      data: {
        boardId: targetBoardId,
        stageName: firstStage.name,
        statusV2: firstStage.defaultTicketStatusV2 ?? undefined,
        eta: ticketEta,
        kanbanPosition,
        updatedAt: now,
        updatedBy,
      },
    });

    await tx.ticketStageEta.deleteMany({ where: { ticketId } });

    if (firstStage.eta !== null && firstStage.eta > 0) {
      await tx.ticketStageEta.create({
        data: {
          ticketId,
          stageId: firstStage.id,
          stageEnteredAt: now,
          stageLeftAt: null,
          stageEta: calculateETADeadline(now, firstStage.eta),
          updatedBy,
          workspaceId: updatedTicket.workspaceId,
        },
      });
    }

    await syncStageOverdueFlag(tx, ticketId, now);

    await syncConversationTicketMdFromPrismaTicket(tx, updatedTicket);
  });
};

export class TicketController {
  private normalizeFilterValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      return value.map(item => this.normalizeFilterValue(item)).sort().join('|');
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value).trim().toLowerCase();
  }

  private matchesCustomFieldFilter(actualValue: unknown, expectedValue: unknown): boolean {
    if (Array.isArray(expectedValue)) {
      if (!Array.isArray(actualValue)) return false;
      const actualSet = new Set(actualValue.map(value => this.normalizeFilterValue(value)));
      return expectedValue.every(value => actualSet.has(this.normalizeFilterValue(value)));
    }

    if (Array.isArray(actualValue)) {
      return actualValue.some(value => this.normalizeFilterValue(value) === this.normalizeFilterValue(expectedValue));
    }

    return this.normalizeFilterValue(actualValue) === this.normalizeFilterValue(expectedValue);
  }

  private async findTicketIdsByCustomFields(
    ticketIds: string[],
    customFields: Record<string, unknown>,
  ): Promise<Set<string>> {
    if (ticketIds.length === 0) {
      return new Set();
    }

    const requestedFilters = Object.entries(customFields)
      .filter(([fieldId]) => fieldId.trim().length > 0)
      .map(([fieldId, expectedValue]) => ({
        fieldId: fieldId.trim(),
        expectedValue,
      }));

    if (requestedFilters.length === 0) {
      return new Set();
    }

    const formEntityValues = await prismaClient.formEntityValues.findMany({
      where: {
        entityType: 'TICKET',
        entityId: { in: ticketIds },
        fieldId: { in: requestedFilters.map(filter => filter.fieldId) },
      },
      select: {
        entityId: true,
        fieldId: true,
        fieldValue: true,
        actualFieldValue: true,
      },
    });

    const valuesByFieldId = new Map<string, typeof formEntityValues>();
    for (const value of formEntityValues) {
      const values = valuesByFieldId.get(value.fieldId) ?? [];
      values.push(value);
      valuesByFieldId.set(value.fieldId, values);
    }

    let candidateIds: Set<string> | null = null;

    for (const { fieldId, expectedValue } of requestedFilters) {
      const values = valuesByFieldId.get(fieldId) ?? [];
      const fieldMatches = new Set(
        values
          .filter(value =>
            this.matchesCustomFieldFilter(value.actualFieldValue ?? value.fieldValue, expectedValue),
          )
          .map(value => value.entityId),
      );

      if (candidateIds === null) {
        candidateIds = fieldMatches;
      } else {
        candidateIds = new Set<string>(
          [...candidateIds].filter((entityId: string) => fieldMatches.has(entityId)),
        );
      }

      if (candidateIds.size === 0) {
        return new Set();
      }
    }

    return candidateIds ?? new Set();
  }

  /**
   * Create a ticket
   * POST /api/external-event/ticket/createTicket
   * 
   * Required fields:
   * - title: string - Title of the ticket
   * - description: string - Description of the ticket
   * - projectId: string - Project ID to which the ticket belongs
   * - boardId: string - Board ID to which the ticket belongs
   * - channelId: string - Channel ID (validated by middleware)
   *
   * Optional fields:
   * - text: string - Text content for the message to which the ticket will be attached (if not provided, no text will be added to the message)
   * - priority: TicketPriority - Priority of the ticket (defaults to LOW)
   * - assignedToEmail: string - Email address of the user to assign the ticket to (user must exist)
   * - assignedUserGroupAlias: string - Alias of the user group to assign the ticket to (user group must exist)
   */
  createTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = CreateTicketBodySchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const {
        title,
        description,
        projectId,
        boardId,
        channelId,
        channelName,
        priority,
        assignedToEmail,
        assignedUserGroupAlias,
        text,
        stageName: requestedStageName,
        eta: etaString,
        ticketType,
        dynamicFields,
      } = bodyResult.data;

      const userId = req.user!.id;

      const board = await repositories.boards.findById(boardId);
      if (!board) {
        res.status(404).json({
          error: `Board with ID ${boardId} not found`,
          code: 'BOARD_NOT_FOUND',
        });
        return;
      }
      let resolvedStageName: string | undefined;
      if (requestedStageName) {
        const stage = await prismaClient.stage.findFirst({
          where: { boardId, name: requestedStageName },
          select: { name: true },
        });
        if (!stage) {
          res.status(400).json({
            error: `Stage "${requestedStageName}" does not exist on board ${boardId}`,
            code: 'STAGE_NOT_FOUND',
          });
          return;
        }
        resolvedStageName = stage.name;
      }

      let etaDate: Date | undefined;
      if (etaString) {
        etaDate = new Date(etaString);
        if (etaDate <= new Date()) {
          res.status(400).json({
            error: 'ETA must be a future date',
            code: 'INVALID_ETA',
          });
          return;
        }
      }

      let customFieldValues: CustomFieldWritePayload | undefined;
      try {
        customFieldValues = await buildCustomFieldWritePayload(
          boardId,
          req.user!.workspaceId!,
          dynamicFields,
        );
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : 'Invalid custom field values',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      // Resolve channelId from channelName if not provided
      const resolvedChannelId = await resolveChannelId(channelId, undefined, channelName);

      const channel = await repositories.channels.findById(resolvedChannelId);
      if (!channel) {
        res.status(404).json({
          error: `Channel with ID ${resolvedChannelId} not found`,
          code: 'CHANNEL_NOT_FOUND',
        });
        return;
      }

      // Resolve assignedToEmail to userId if provided
      let assignedTo: string | undefined;
      if (assignedToEmail) {
        const user = await repositories.users.findByEmail(assignedToEmail, req.user!.workspaceId!);
        if (!user) {
          res.status(404).json({
            error: `User with email ${assignedToEmail} not found`,
            code: 'USER_NOT_FOUND',
          });
          return;
        }
        assignedTo = user.id;
      }

      // Resolve assignedUserGroupAlias to userGroupId if provided
      let userGroupId: string | undefined;
      if (assignedUserGroupAlias) {
        const userGroup = await repositories.userGroups.findByAlias(assignedUserGroupAlias, req.user!.workspaceId!);
        if (!userGroup) {
          res.status(404).json({
            error: `User group with alias ${assignedUserGroupAlias} not found`,
            code: 'USER_GROUP_NOT_FOUND',
          });
          return;
        }
        userGroupId = userGroup.id;
      }

      let resolvedAssignedTo = assignedTo;
      let pendingFullRoleAssignment = false;

      if (userGroupId && !assignedTo) {
        try {
          const boardRow = await prismaClient.board.findUnique({ where: { id: boardId }, select: { metadata: true } });
          const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

          if (boardMetadata?.fullRoleAssignment === true) {
            // Full role assignment will be done after ticket creation
            pendingFullRoleAssignment = true;
          } else {
          const assignmentResult = await evaluateAssignmentRule(userGroupId, boardId, undefined, undefined, projectId);
          if (assignmentResult.assignedUserId) {
            resolvedAssignedTo = assignmentResult.assignedUserId;
            }
          }
        } catch (error) {
          logger.error('[Apps Ticket Creation] Error during auto-assignment:', error);
        }
      }

      // Create ticket with conversation using utility function
      const result = await createTicketWithConversation({
        title,
        description,
        projectId,
        boardId,
        channelId: resolvedChannelId,
        userId,
        priority,
        assignedTo: resolvedAssignedTo,
        userGroupId,
        text,
        stageName: resolvedStageName,
        eta: etaDate,
        ticketType,
        customFieldValues,
      });

      // Check for duplicate tickets and persist references
      if (result.ticketId) {
        ticketDuplicateService.persistDuplicateReferences({
          ticketId: result.ticketId,
          ticketCreatedBy: userId,
          title,
          description,
          projectId,
          userId,
        }).catch(error => {
          logger.error('[Apps Ticket Creation] Failed to persist duplicate references for ticket', {
            ticketId: result.ticketId,
            error,
          });
        });
      }

      if (pendingFullRoleAssignment && userGroupId && result.ticketId) {
        try {
          const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
            ticketId: result.ticketId,
            userGroupId,
            boardId,
            createdBy: userId,
            projectId,
          });
          const primaryUserId = primaryUserIdOf(fullRoles);
          if (primaryUserId) {
            const updatedTicket = await prismaClient.ticket.update({
              where: { id: result.ticketId },
              data: { assignedTo: primaryUserId },
            });
            await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
          }
        } catch (error) {
          logger.error('[Apps Ticket Creation] Error during full role assignment:', error);
        }
      }

      res.status(201).json(result);
    } catch (error) {
      logger.error('Error creating ticket:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('No stages found')) {
          res.status(404).json({
            error: error.message,
            code: 'NOT_FOUND',
          });
          return;
        }
      }

      res.status(500).json({ 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  };

  /**
   * Update a ticket - Generic update endpoint
   * POST /api/apps/ticket/updateTicket
   * 
   * Required fields:
   * - ticketId: string - ID of the ticket to update
   * - userId: string - User ID performing the update
   * - channelId or conversationId: string - For channel access validation
   * 
   * Optional fields (at least one required):
   * - assigneeId: string - Update ticket assignee
   * - stage: string - Update ticket stage
   * - groupId: string - Assign user group to ticket
   */
  updateTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = UpdateTicketBodySchema.safeParse(req.body);

      logger.info(`[TicketController] Received update ticket request`, {
        body: req.body,
        validationSuccess: bodyResult.success,
        validationErrors: bodyResult.success ? null : bodyResult.error.errors,
      });
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const {
        ticketId,
        assigneeId,
        assignedToEmail,
        assignedUserGroupAlias,
        stageName,
        groupId,
        title,
        description,
        priority,
        eta: etaString,
        ticketType,
        statusV2,
        boardId,
        isArchived,
        tags,
        dynamicFields,
      } = bodyResult.data;

      const userId = req.user!.id;

      logger.info(`[TicketController] Updating ticket: ${ticketId}`, {
        userId, assigneeId, assignedToEmail, assignedUserGroupAlias, stageName, groupId, boardId,
        title: !!title, description: !!description, priority, eta: etaString, ticketType, statusV2,
        isArchived, tagsCount: tags?.length, dynamicFieldsCount: dynamicFields ? Object.keys(dynamicFields).length : 0,
      });

      // Fetch the ticket to validate it exists and get board/project context
      const ticket = await prismaClient.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          boardId: true,
          projectId: true,
          workspaceId: true,
          conversationId: true,
          statusV2: true,
          userGroupId: true,
          assignedTo: true,
        },
      });
      if (!ticket) {
        res.status(404).json({
          error: `Ticket with ID ${ticketId} not found`,
          code: 'TICKET_NOT_FOUND',
        });
        return;
      }

      const targetBoardId = boardId ?? ticket.boardId;

      if (boardId) {
        const board = await repositories.boards.findById(boardId);
        if (!board) {
          res.status(404).json({
            error: `Board with ID ${boardId} not found`,
            code: 'BOARD_NOT_FOUND',
          });
          return;
        }
      }

      // --- Validate stageName exists on the target board ---
      if (stageName) {
        const stage = await prismaClient.stage.findFirst({
          where: { boardId: targetBoardId, name: stageName },
          select: { name: true, defaultTicketStatusV2: true },
        });
        if (!stage) {
          res.status(400).json({
            error: `Stage "${stageName}" does not exist on board ${targetBoardId}`,
            code: 'STAGE_NOT_FOUND',
          });
          return;
        }
      }

      // --- Validate ETA is in the future ---
      let etaDate: Date | undefined;
      if (etaString) {
        etaDate = new Date(etaString);
        if (etaDate <= new Date()) {
          res.status(400).json({
            error: 'ETA must be a future date',
            code: 'INVALID_ETA',
          });
          return;
        }
      }

      // --- Resolve assignedToEmail to a userId ---
      let resolvedAssigneeId: string | null | undefined = assigneeId;
      if (assignedToEmail) {
        const user = await repositories.users.findByEmail(assignedToEmail, req.user!.workspaceId!);
        if (!user) {
          res.status(404).json({
            error: `User with email ${assignedToEmail} not found`,
            code: 'USER_NOT_FOUND',
          });
          return;
        }
        resolvedAssigneeId = user.id;
      }

      // --- Resolve assignedUserGroupAlias to groupId ---
      let resolvedGroupId: string | null | undefined = groupId;
      if (assignedUserGroupAlias) {
        const userGroup = await repositories.userGroups.findByAlias(
          assignedUserGroupAlias,
          req.user!.workspaceId!,
        );
        if (!userGroup) {
          res.status(404).json({
            error: `User group with alias ${assignedUserGroupAlias} not found`,
            code: 'USER_GROUP_NOT_FOUND',
          });
          return;
        }
        resolvedGroupId = userGroup.id;
      }

      let customFieldValues: CustomFieldWritePayload | undefined;
      try {
        customFieldValues = await buildCustomFieldWritePayload(
          targetBoardId,
          req.user!.workspaceId!,
          dynamicFields,
          {
            requireAllRequiredFields: false,
            ticketId: ticket.id,
          },
        );
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : 'Invalid custom field values',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      if (isArchived === true) {
        const finalStatus = statusV2 ?? ticket.statusV2;
        if (finalStatus !== TicketStatusV2.COMPLETED && finalStatus !== TicketStatusV2.CANCELLED) {
          res.status(400).json({
            error: 'Ticket must be in Completed or Cancelled status to be archived',
            code: 'INVALID_ARCHIVE_STATE',
          });
          return;
        }
      }

      // --- Execute updates ---
      if (boardId && boardId !== ticket.boardId) {
        await transferTicketToBoard({
          ticketId,
          targetBoardId: boardId,
          updatedBy: userId,
        });
        logger.info(`[TicketController] Ticket board updated: ${ticketId}`, { boardId });
      }

      // Assignee
      if (resolvedAssigneeId !== undefined) {
        if (resolvedAssigneeId === null || resolvedAssigneeId === '') {
          await repositories.tickets.updateTicketAssignee(ticketId, null, userId);
        } else {
          await ticketService.updateTicketAssignee(ticketId, userId, resolvedAssigneeId);
        }
        logger.info(`[TicketController] Ticket assignee updated: ${ticketId}`);
      }

      // Stage (updateTicketStageForWorkflow also updates statusV2 via defaultTicketStatusV2)
      if (stageName) {
        await ticketService.updateTicketStageForWorkflow(ticketId, userId, stageName);
        logger.info(`[TicketController] Ticket stage updated: ${ticketId}`);
      }

      // User group
      if (resolvedGroupId !== undefined) {
        if (resolvedGroupId === null || resolvedGroupId === '') {
          const updatedTicket = await prismaClient.ticket.update({
            where: { id: ticketId },
            data: { userGroupId: null, updatedBy: userId, updatedAt: new Date() },
          });
          await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
        } else {
          await ticketService.asignUserGroupToTicket(ticketId, userId, resolvedGroupId);
        }
        logger.info(`[TicketController] User group updated: ${ticketId}`);
      }

      // Direct field updates: title, description, priority, eta, ticketType, statusV2, isArchived
      const directUpdates: Parameters<typeof repositories.tickets.updateTicketFields>[1] = {};
      if (title !== undefined) directUpdates.title = title;
      if (description !== undefined) directUpdates.description = description;
      if (priority !== undefined) directUpdates.priority = priority;
      if (etaString === null) directUpdates.eta = null;
      else if (etaDate !== undefined) directUpdates.eta = etaDate;
      if (ticketType !== undefined) directUpdates.ticketType = ticketType;
      if (statusV2 !== undefined) directUpdates.statusV2 = statusV2;
      if (isArchived !== undefined) directUpdates.isArchived = isArchived;

      if (Object.keys(directUpdates).length > 0) {
        await repositories.tickets.updateTicketFields(ticketId, directUpdates, userId);
        logger.info(`[TicketController] Ticket direct fields updated: ${ticketId}`, { fields: Object.keys(directUpdates) });
      }

      if (tags !== undefined) {
        await replaceTicketTags(ticketId, tags);
        logger.info(`[TicketController] Ticket tags replaced: ${ticketId}`, { tagsCount: tags.length });
      }

      if (customFieldValues && customFieldValues.fieldValues.length > 0) {
        await syncCustomFieldValues(ticketId, customFieldValues, userId);
        logger.info(`[TicketController] Ticket custom fields updated: ${ticketId}`, {
          fields: customFieldValues.fieldValues.length,
        });
      }

      const effectiveGroupId =
        resolvedGroupId !== undefined
          ? resolvedGroupId === '' ? null : resolvedGroupId
          : ticket.userGroupId;
      const shouldAutoAssign =
        !resolvedAssigneeId &&
        effectiveGroupId &&
        ((boardId && boardId !== ticket.boardId) || resolvedGroupId !== undefined);

      if (shouldAutoAssign) {
        try {
          const boardRow = await prismaClient.board.findUnique({
            where: { id: targetBoardId },
            select: { metadata: true },
          });
          const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

          if (
            (Array.isArray(boardMetadata?.assignmentRoles) && boardMetadata!.assignmentRoles!.length > 0)
            || boardMetadata?.fullRoleAssignment === true
          ) {
            const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
              ticketId,
              userGroupId: effectiveGroupId,
              boardId: targetBoardId,
              createdBy: userId,
              projectId: ticket.projectId,
            });
            const primaryUserId = primaryUserIdOf(fullRoles);
            if (primaryUserId) {
              const updatedTicket = await prismaClient.ticket.update({
                where: { id: ticketId },
                data: { assignedTo: primaryUserId, updatedBy: userId, updatedAt: new Date() },
              });
              await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
            }
          } else {
            const assignmentResult = await evaluateAssignmentRule(
              effectiveGroupId,
              targetBoardId,
              undefined,
              undefined,
              ticket.projectId,
            );
            if (assignmentResult.assignedUserId) {
              await ticketService.updateTicketAssignee(ticketId, userId, assignmentResult.assignedUserId);
            }
          }
        } catch (error) {
          logger.error('[TicketController] Error during auto-assignment after ticket update:', error);
        }
      }

      res.status(200).json({ success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('[TicketController] Error updating ticket:', {
        error: errorMessage,
        stack: errorStack,
        ticketId: req.body.ticketId,
        userId: req.user?.id,
      });
      res.status(500).json({ 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: errorMessage,
      });
    }
  };

  /**
   * List tickets raised by an external merchant (email sender).
   * GET /api/apps/ticket/listBySender?channelIds=id1,id2&senderEmail=...&limit=20&cursor=...
   * Also supports repeated channelId=... or a single channelId for backward compatibility.
   */
  listBySender = async (req: Request, res: Response): Promise<void> => {
    try {
      const channelIds = parseListBySenderChannelIds(req.query);
      const queryResult = ListBySenderQuerySchema.safeParse({
        ...req.query,
        channelIds,
      });
      if (!queryResult.success) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: queryResult.error.errors,
        });
        return;
      }

      const { channelIds: validatedChannelIds, senderEmail, limit: rawLimit, cursor } =
        queryResult.data;
      const limit = Math.min(Math.max(rawLimit, 1), 100);
      const decodedCursor = decodeCursor<MerchantTicketsListCursor>(cursor);

      const access = await validateChannelIdsAccess(validatedChannelIds, req.user!.id);
      if (!access.ok) {
        res.status(access.status).json({
          error: access.error,
          message: access.message,
        });
        return;
      }

      const normalizedSender =
        extractEmailAddress(senderEmail) ?? senderEmail.trim().toLowerCase();

      const tickets = await repositories.tickets.findTicketsByMerchantSenderEmail({
        channelIds: validatedChannelIds,
        senderEmail: normalizedSender,
        limit,
        cursor: decodedCursor
          ? { id: decodedCursor.id, createdAt: new Date(decodedCursor.createdAt) }
          : undefined,
      });

      const items: MerchantTicketListItem[] = tickets.map(ticket => {
        const metadata = ticket.metadata as { reporterEmail?: string } | null;
        return {
          ticketId: ticket.id,
          xyneId: ticket.xyneId,
          title: ticket.title,
          statusV2: ticket.statusV2,
          stageName: ticket.stageName,
          priority: ticket.priority,
          createdAt: ticket.createdAt,
          lastEmailAt: ticket.lastEmailAt,
          conversationId: ticket.conversationId,
          channelId: ticket.channelId,
          senderEmail: metadata?.reporterEmail ?? normalizedSender,
        };
      });

      const pagination = paginateResults(
        items,
        limit,
        (item): MerchantTicketsListCursor => ({
          id: item.ticketId,
          createdAt: item.createdAt.getTime(),
        }),
      );

      res.status(200).json({
        items: pagination.items,
        nextCursor: pagination.nextCursor,
        hasMore: pagination.hasMore,
      });
    } catch (error) {
      logger.error('[TicketController] listBySender error:', error);
      if (error instanceof Error && error.message === 'Invalid cursor format') {
        res.status(400).json({ error: error.message, code: 'VALIDATION_ERROR' });
        return;
      }
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };

  /**
   * Search tickets with dynamic filters using a JSON body.
   * POST /api/apps/ticket/list/search
   */
  searchTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const bodyResult = SearchTicketsBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors,
        });
        return;
      }

      const userId = req.user?.id;
      if (!userId) {
        res.status(400).json({
          error: 'Authenticated user is required',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(400).json({
          error: 'Authenticated workspace is required',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const { channelId, boardIds, projectId, senderEmail, senderName, filters, customFields, includeCustomFields, limit, cursor } = bodyResult.data;
      const channelIds = channelId ? [channelId] : [];

      // Channel scope keeps its participant ACL; board/project rely on the workspace backstop.
      if (channelIds.length > 0) {
        const access = await validateChannelIdsAccess(channelIds, userId);
        if (!access.ok) {
          res.status(access.status).json({
            error: access.error,
            message: access.message,
          });
          return;
        }
      }

      const decodedCursor = decodeCursor<MerchantTicketsListCursor>(cursor);

      let conversationIdsBySender: string[] | undefined;
      const emailWhere: Prisma.EmailWhereInput = {
        type: EmailType.DEFAULT,
        // Narrow the sender lookup by channel, else by workspace (the ticket query is the
        // real isolation boundary). workspaceId is now non-nullable, so scope directly to it.
        ...(channelIds.length > 0
          ? { channelId: { in: channelIds } }
          : { workspaceId }),
      };

      if (senderEmail) {
        const normalizedSenderEmail =
          extractEmailAddress(senderEmail) ?? senderEmail.trim().toLowerCase();
        emailWhere.from = { contains: normalizedSenderEmail, mode: 'insensitive' };
      }

      if (senderName) {
        emailWhere.AND = [{ from: { contains: senderName.trim(), mode: 'insensitive' } }];
      }

      if (senderEmail || senderName) {
        const matchingEmails = await prismaClient.email.findMany({
          where: emailWhere,
          select: { conversationId: true },
          distinct: ['conversationId'],
        });
        conversationIdsBySender = matchingEmails.map(email => email.conversationId);

        if (conversationIdsBySender.length === 0) {
          res.status(200).json({ items: [], hasMore: false });
          return;
        }
      }

      const where: Prisma.TicketWhereInput = {
        // Tenant-isolation backstop: board/project searches have no ACL of their own.
        workspaceId,
        isArchived: false,
        ...(channelIds.length > 0 ? { channelId: { in: channelIds } } : {}),
        ...(boardIds && boardIds.length > 0 ? { boardId: { in: boardIds } } : {}),
        ...(projectId ? { projectId } : {}),
        ...(conversationIdsBySender
          ? {
              conversationId: { in: conversationIdsBySender },
            }
          : ((senderEmail || senderName)
              ? {
                  conversationId: { in: [] },
                }
              : {})),
      };

      if (filters) {
        const normalizedFilters: TicketFilters = {
          statusV2: filters.statusV2,
          priority: filters.priority,
          stageName: filters.stageName,
          ticketType: filters.ticketType,
          assignedTo: filters.assignedTo,
          createdBy: filters.createdBy,
          userGroupId: filters.userGroupId,
          tags: filters.tags,
          isArchived: filters.isArchived,
          createdAfter: filters.createdAfter ? new Date(filters.createdAfter) : undefined,
          createdBefore: filters.createdBefore ? new Date(filters.createdBefore) : undefined,
        };
        // Merge core + related-table (tags) predicates. isArchived (if provided)
        // overrides the default false set above; createdAt range is ANDed with
        // the keyset cursor predicate below via distinct where keys.
        Object.assign(where, buildTicketFilterWhere(normalizedFilters));
      }

      if (decodedCursor) {
        where.AND = [{
          OR: [
            { createdAt: { lt: new Date(decodedCursor.createdAt) } },
            { createdAt: new Date(decodedCursor.createdAt), id: { lt: decodedCursor.id } },
          ],
        }];
      }

      const ticketSelect = {
        id: true,
        xyneId: true,
        title: true,
        statusV2: true,
        stageName: true,
        priority: true,
        createdAt: true,
        lastEmailAt: true,
        conversationId: true,
        channelId: true,
        boardId: true,
        projectId: true,
      } as const;

      const hasCustomFieldFilters = !!(customFields && Object.keys(customFields).length > 0);
      let tickets: Array<Prisma.TicketGetPayload<{ select: typeof ticketSelect }>>;

      if (!hasCustomFieldFilters) {
        tickets = await prismaClient.ticket.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          select: ticketSelect,
        });
      } else {
        const batchSize = Math.max(limit * 3, 50);
        const matchedTickets: Array<Prisma.TicketGetPayload<{ select: typeof ticketSelect }>> = [];
        let batchCursor = decodedCursor;

        while (matchedTickets.length < limit + 1) {
          const batchWhere: Prisma.TicketWhereInput = { ...where };

          if (batchCursor) {
            batchWhere.AND = [{
              OR: [
                { createdAt: { lt: new Date(batchCursor.createdAt) } },
                { createdAt: new Date(batchCursor.createdAt), id: { lt: batchCursor.id } },
              ],
            }];
          }

          const batch = await prismaClient.ticket.findMany({
            where: batchWhere,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: batchSize,
            select: ticketSelect,
          });

          if (batch.length === 0) {
            break;
          }

          const matchingIds = await this.findTicketIdsByCustomFields(
            batch.map(ticket => ticket.id),
            customFields!,
          );

          for (const ticket of batch) {
            if (matchingIds.has(ticket.id)) {
              matchedTickets.push(ticket);
              if (matchedTickets.length >= limit + 1) {
                break;
              }
            }
          }

          if (batch.length < batchSize) {
            break;
          }

          const lastTicket = batch[batch.length - 1];
          batchCursor = {
            id: lastTicket.id,
            createdAt: lastTicket.createdAt.getTime(),
          };
        }

        tickets = matchedTickets;
      }

      const customFormDataByTicketId = new Map<string, TicketCustomFormData | null>();
      if (includeCustomFields) {
        await Promise.all(
          tickets
            .filter((ticket): ticket is typeof ticket & { boardId: string } => !!ticket.boardId)
            .map(async ticket => {
              const customFormData = await repositories.forms.getTicketCustomFormData(ticket.id, ticket.boardId);
              customFormDataByTicketId.set(ticket.id, customFormData);
            }),
        );
      }

      const items: MerchantTicketListItem[] = tickets.map(ticket => {
        return {
          ticketId: ticket.id,
          xyneId: ticket.xyneId,
          title: ticket.title,
          statusV2: ticket.statusV2,
          stageName: ticket.stageName,
          priority: ticket.priority,
          createdAt: ticket.createdAt,
          lastEmailAt: ticket.lastEmailAt,
          conversationId: ticket.conversationId,
          channelId: ticket.channelId,
          boardId: ticket.boardId,
          projectId: ticket.projectId,
          ...(includeCustomFields ? { customFormData: customFormDataByTicketId.get(ticket.id) ?? null } : {}),
        };
      });

      const pagination = paginateResults(
        items,
        limit,
        (item): MerchantTicketsListCursor => ({
          id: item.ticketId,
          createdAt: item.createdAt.getTime(),
        }),
      );

      res.status(200).json(pagination);
    } catch (error) {
      logger.error('[TicketController] searchTickets error:', error);
      if (error instanceof Error && error.message === 'Invalid cursor format') {
        res.status(400).json({ error: error.message, code: 'VALIDATION_ERROR' });
        return;
      }
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };

  /**
   * Get ticket information by xyneId
   * GET /:xyneId
   */
  getInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const { xyneId } = req.params;
      const workspaceId = req.user?.workspaceId;
      const userId = req.user?.id;

      if (!xyneId) {
        res.status(400).json({
          error: 'xyneId is required',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      if (!workspaceId) {
        res.status(400).json({
          error: 'Authenticated workspace is required',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      if (!userId) {
        res.status(400).json({
          error: 'Authenticated user is required',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const ticketInfo = await fetchTicketInfoByIdentifier(
        {
          identifier: xyneId,
          workspaceId,
          historyLimit: normalizeHistoryLimit(req.query.historyLimit),
        },
        {
          getTicketByIdentifier: repositories.tickets.getTicketByXyneIdOrId.bind(repositories.tickets),
          getTicketCustomFormData: repositories.forms.getTicketCustomFormData.bind(repositories.forms),
          getTicketHistory: repositories.tickets.getTicketHistory.bind(repositories.tickets),
        },
      );

      if (!ticketInfo) {
        res.status(404).json({
          error: `Ticket with xyneId ${xyneId} not found`,
          code: 'TICKET_NOT_FOUND',
        });
        return;
      }

      const channel = await repositories.channels.findById(ticketInfo.ticket.channelId);
      if (!channel) {
        res.status(404).json({
          error: 'Channel not found',
          code: 'CHANNEL_NOT_FOUND',
        });
        return;
      }

      const isParticipant = await repositories.channelParticipants.isParticipant(
        ticketInfo.ticket.channelId,
        userId,
      );
      if (!isParticipant) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Bot does not have channel access',
        });
        return;
      }

      res.status(200).json({
        ...ticketInfo.ticket,
        customFormData: ticketInfo.customFormData,
        history: ticketInfo.history,
      });
    } catch (error) {
      logger.error('[TicketController] Error fetching ticket info:', error);
      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  };

  /**
   * Get the full email thread conversation for a ticket by ticket id or xyneId.
   * This matches appDeskInbound storage, which persists into the Email table.
   * GET /api/apps/ticket/:ticketId/conversation
   */
  getConversation = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId } = req.params;
      const workspaceId = req.user?.workspaceId;
      const userId = req.user?.id;
      const queryResult = TicketConversationQuerySchema.safeParse(req.query);

      if (!queryResult.success) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: queryResult.error.errors,
        });
        return;
      }

      const { limit, cursor } = queryResult.data;
      const decodedCursor = decodeCursor<TicketConversationCursor>(cursor);

      if (!ticketId) {
        res.status(400).json({
          error: 'ticketId is required',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      if (!workspaceId) {
        res.status(400).json({
          error: 'Authenticated workspace is required',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      if (!userId) {
        res.status(400).json({
          error: 'Authenticated user is required',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const ticket = await repositories.tickets.getTicketByXyneIdOrId(ticketId, workspaceId);
      if (!ticket) {
        res.status(404).json({
          error: `Ticket ${ticketId} not found`,
          code: 'TICKET_NOT_FOUND',
        });
        return;
      }

      if (!ticket.conversationId) {
        res.status(404).json({
          error: `Ticket ${ticketId} has no linked conversation`,
          code: 'CONVERSATION_NOT_FOUND',
        });
        return;
      }

      if (!(await repositories.channels.findById(ticket.channelId))) {
        res.status(404).json({
          error: 'Channel not found',
          code: 'CHANNEL_NOT_FOUND',
        });
        return;
      }

      const isParticipant = await repositories.channelParticipants.isParticipant(ticket.channelId, userId);
      if (!isParticipant) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Bot does not have channel access',
        });
        return;
      }

      const emails = await repositories.emails.findManyWithForwardCursor(
        ticket.conversationId,
        limit + 1,
        decodedCursor,
      );
      const attachments = await repositories.messageAttachments.findByEmailIds(
        emails.map(email => email.id),
      );
      const attachmentsByEmailId = new Map<string, typeof attachments>();

      for (const attachment of attachments) {
        const existing = attachmentsByEmailId.get(attachment.entityId) ?? [];
        existing.push(attachment);
        attachmentsByEmailId.set(attachment.entityId, existing);
      }

      const pagination = paginateResults(
        emails,
        limit,
        (email): TicketConversationCursor => ({
          id: email.id,
          createdAt: email.createdAt.getTime(),
        }),
      );

      res.status(200).json({
        ticketId: ticket.id,
        xyneId: ticket.xyneId,
        conversationId: ticket.conversationId,
        channelId: ticket.channelId,
        items: pagination.items.map(email => ({
          id: email.id,
          type: email.type,
          subject: email.subject,
          body: email.body,
          to: email.to,
          from: email.from,
          cc: email.cc,
          bcc: email.bcc,
          replyTo: email.replyTo,
          externalThreadId: email.externalThreadId,
          externalMessageId: email.externalMessageId,
          sentByUserId: email.sentByUserId,
          attachments: (attachmentsByEmailId.get(email.id) ?? []).map(attachment => ({
            id: attachment.id,
            originalFilename: attachment.originalFilename,
            mimetype: attachment.mimetype,
            size: attachment.size,
            url: `${appsFilesBaseUrl}/download/${attachment.id}`,
            storagePath: attachment.url,
            thumbnailUrl: attachment.thumbnailUrl,
            width: attachment.width,
            height: attachment.height,
            createdAt: attachment.createdAt,
            conversationId: attachment.conversationId,
          })),
          createdAt: email.createdAt,
          updatedAt: email.updatedAt,
        })),
        nextCursor: pagination.nextCursor,
        hasMore: pagination.hasMore,
      });
    } catch (error) {
      logger.error('[TicketController] Error fetching ticket conversation:', error);
      if (error instanceof Error && error.message === 'Invalid cursor format') {
        res.status(400).json({ error: error.message, code: 'VALIDATION_ERROR' });
        return;
      }
      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  };

  /**
   * Update a form field value on a ticket
   * POST /api/apps/ticket/updateFormField
   * 
   * This is a generic endpoint for apps to update custom form fields on tickets.
   * Used by external systems (like Genius) to update field values.
   */
  updateFormField = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId, fieldName, fieldValue, channelId, channelName, conversationId, sessionId: _sessionId } = req.body;

      const workspaceId = req.user?.workspaceId;
      const userId = req.user?.id;
      if (!workspaceId || !userId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      // Validate required fields
      if (!ticketId || typeof ticketId !== 'string') {
        res.status(400).json({ error: 'ticketId is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (!fieldName || typeof fieldName !== 'string') {
        res.status(400).json({ error: 'fieldName is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (fieldValue === undefined || fieldValue === null) {
        res.status(400).json({ error: 'fieldValue is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (!channelId && !channelName && !conversationId) {
        res.status(400).json({ error: 'Either channelId, channelName, or conversationId is required', code: 'VALIDATION_ERROR' });
        return;
      }

      logger.info(`[TicketController] Updating form field: ${fieldName} on ticket ${ticketId}`);

      // Fetch ticket to get board context and conversation.
      // Scope the lookup to the caller's workspace.
      const ticket = await prismaClient.ticket.findFirst({
        where: { id: ticketId, workspaceId },
        select: { id: true, boardId: true, conversationId: true, workspaceId: true, channelId: true, projectId: true, createdBy: true },
      });

      if (!ticket) {
        res.status(404).json({ error: `Ticket ${ticketId} not found`, code: 'TICKET_NOT_FOUND' });
        return;
      }

      // Authorize against the TARGET ticket's own channel, not the channel supplied in the
      // request body, so the authorized object equals the mutated object. PUBLIC channel = any
      // workspace member; PRIVATE = participant only.
      const ticketChannelId =
        ticket.channelId ??
        (ticket.conversationId
          ? (await repositories.conversations.findById(ticket.conversationId))?.channelId ?? null
          : null);
      if (ticketChannelId) {
        const ticketChannel = await repositories.channels.findById(ticketChannelId);
        if (!ticketChannel || ticketChannel.workspaceId !== workspaceId) {
          res.status(404).json({ error: `Ticket ${ticketId} not found`, code: 'TICKET_NOT_FOUND' });
          return;
        }
        if (ticketChannel.visibility === 'PRIVATE') {
          const isParticipant = await repositories.channelParticipants.isParticipant(ticketChannelId, userId);
          if (!isParticipant) {
            res.status(403).json({ error: 'Access denied - not a channel participant', code: 'FORBIDDEN' });
            return;
          }
        }
      }

      // Get form mapping for this board
      const formMapping = await prismaClient.formContextMapping.findFirst({
        where: { contextId: ticket.boardId, contextType: 'BOARD', entityType: 'TICKET' },
        select: { formId: true },
      });

      if (!formMapping) {
        res.status(404).json({ error: 'No form configured for board', code: 'FORM_NOT_FOUND' });
        return;
      }

      const formFields = await resolveFormFieldDefinitionsForForm(prismaClient, formMapping.formId);
      const field = formFields.find(f => f.fieldName === fieldName);

      if (!field) {
        res.status(404).json({ error: `Field "${fieldName}" not found`, code: 'FIELD_NOT_FOUND' });
        return;
      }

      let normalizedFieldValue: ReturnType<typeof normalizeCustomFieldValue>;
      try {
        if (field.parentOptionId) {
          const branchLink = resolveParentOption(formFields, field.parentOptionId);
          const savedParentValues = branchLink
            ? await resolveSavedParentValues({
                ticketId,
                fieldIds: [branchLink.parentField.id],
                contextId: ticket.boardId,
              })
            : new Map<string, string>();
          const parentEffectiveValue = branchLink
            ? (savedParentValues.get(branchLink.parentField.id) ?? null)
            : null;
          if (!branchLink || branchLink.option.value !== parentEffectiveValue) {
            throw new Error(
              `Field "${field.fieldName}" is not applicable for the currently selected value of its parent field`,
            );
          }
        }
        normalizedFieldValue = normalizeCustomFieldValue(field, fieldValue);
        await validateUserCustomFieldReferences(
          [{
            fieldName: field.fieldName,
            fieldType: field.fieldType,
            actualFieldValue: normalizedFieldValue.actualFieldValue,
          }],
          ticket.workspaceId,
        );
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : 'Invalid form field value',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const timestamp = new Date();
      const stringValue = normalizedFieldValue.fieldValue;

      // Upsert the form entity value
      const existing = await prismaClient.formEntityValues.findFirst({
        where: { entityId: ticketId, entityType: 'TICKET', fieldId: field.id },
      });

      if (existing) {
        await prismaClient.formEntityValues.update({
          where: { id: existing.id },
          data: {
            fieldValue: stringValue,
            actualFieldValue: normalizedFieldValue.actualFieldValue,
            updatedAt: timestamp,
          },
        });
      } else {
        await prismaClient.formEntityValues.create({
          data: {
            id: `fev_${ticketId}_${field.id}_${Date.now()}`,
            entityId: ticketId,
            entityType: 'TICKET',
            formId: formMapping.formId,
            fieldId: field.id,
            fieldValue: stringValue,
            actualFieldValue: normalizedFieldValue.actualFieldValue,
            workspaceId: ticket.workspaceId,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });
      }

      await createTicketCustomFieldActivity({
        ticketId,
        fieldName: field.fieldName,
        oldValue: existing?.actualFieldValue ?? existing?.fieldValue,
        newValue: normalizedFieldValue.actualFieldValue,
        updatedBy: req.user!.id,
        timestamp,
      });

      logger.info(`[TicketController] Form field "${fieldName}" updated to "${stringValue}" on ticket ${ticketId}`);

      // Emit ADDITIONAL_FORM_FIELD_UPDATED event to all apps in the workspace
      // Apps (like Genius) filter by fieldName and boardName to handle specific cases
      try {
        const board = await prismaClient.board.findUnique({
          where: { id: ticket.boardId },
          select: { id: true, name: true },
        });

        const conversation = ticket.conversationId
          ? await prismaClient.conversation.findUnique({
              where: { conversationId: ticket.conversationId },
              select: { channelId: true },
            })
          : null;

        if (board) {
          const payload: AdditionalFormFieldUpdatedPayload = {
            ticketId,
            conversationId: ticket.conversationId || '',
            channelId: conversation?.channelId || '',
            boardId: ticket.boardId,
            boardName: board.name,
            fieldName,
            fieldValue: stringValue,
            previousValue: existing?.fieldValue || undefined,
            updatedBy: req.user!.id,
            workspaceId,
          };

          const event: BaseAppEvent = {
            eventType: AppEventType.ADDITIONAL_FORM_FIELD_UPDATED,
            payload,
            timestamp: new Date().toISOString(),
          };

          // Fire and forget - don't block the response.
          void emitEventToWorkspaceApps(workspaceId, event);
          
          logger.info(`[TicketController] Emitted ADDITIONAL_FORM_FIELD_UPDATED for field "${fieldName}" on ticket ${ticketId}`);
        }

        // Emit TICKET_UPDATED
        // Key by fieldId + fieldName + fieldName.toLowerCase() so conditions referencing
        // either the ID or the name resolve correctly.
        const prevValue = existing?.actualFieldValue ?? existing?.fieldValue ?? null;
        const newValue = normalizedFieldValue.actualFieldValue ?? stringValue;
        const toChangeValue = (v: unknown): string | number | null => {
          if (typeof v === 'string' || typeof v === 'number') return v;
          if (v == null) return null;
          return String(v);
        };
        const prevNorm = toChangeValue(prevValue);
        const newNorm = toChangeValue(newValue);
        if (prevNorm === newNorm) {
          res.status(200).json({ success: true, fieldName, ticketId });
          return;
        }
        const changeEntry = {
          previousValue: prevNorm,
          newValue: newNorm,
        };
        void emitTicketUpdated({
          ticket: { ...ticket, channelId: ticket.channelId ?? '', projectId: ticket.projectId ?? '', createdBy: ticket.createdBy ?? '' },
          changes: {},
          formFieldChanges: {
            [field.id]: changeEntry,
            [field.fieldName]: changeEntry,
            [field.fieldName.toLowerCase()]: changeEntry,
          },
          performedById: req.user!.id,
        });
      } catch (eventError) {
        // Don't fail the request if event emission fails
        logger.error('[TicketController] Error emitting form field update event:', eventError);
      }

      res.status(200).json({ success: true, fieldName, ticketId });
    } catch (error) {
      logger.error('[TicketController] Error updating form field:', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };

  /**
   * Disable email sending for a ticket
   * POST /api/apps/ticket/disableEmailSend
   */
  disableEmailSend = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId, channelId, channelName, conversationId } = req.body;

      if (!ticketId || typeof ticketId !== 'string') {
        res.status(400).json({ error: 'ticketId is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (!channelId && !channelName && !conversationId) {
        res.status(400).json({ error: 'Either channelId, channelName, or conversationId is required', code: 'VALIDATION_ERROR' });
        return;
      }

      logger.info(`[TicketController] Disabling email reply for ticket ${ticketId}`);

      // Fetch ticket to verify it exists
      const ticket = await prismaClient.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, workspaceId: true },
      });

      if (!ticket) {
        res.status(404).json({ error: `Ticket ${ticketId} not found`, code: 'TICKET_NOT_FOUND' });
        return;
      }

      // Update ticket emailReplyEnabled column
      await prismaClient.ticket.update({
        where: { id: ticketId },
        data: { emailReplyEnabled: false },
      });

      logger.info(`[TicketController] Disabled email reply for ticket ${ticketId}`);

      res.status(200).json({ success: true, ticketId, emailReplyEnabled: false });
    } catch (error) {
      logger.error('[TicketController] Error disabling email send:', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };

  /**
   * Enable email sending for a ticket
   * POST /api/apps/ticket/enableEmailSend
   */
  enableEmailSend = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId, channelId, channelName, conversationId } = req.body;

      if (!ticketId || typeof ticketId !== 'string') {
        res.status(400).json({ error: 'ticketId is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (!channelId && !channelName && !conversationId) {
        res.status(400).json({ error: 'Either channelId, channelName, or conversationId is required', code: 'VALIDATION_ERROR' });
        return;
      }

      logger.info(`[TicketController] Enabling email reply for ticket ${ticketId}`);

      // Fetch ticket to verify it exists
      const ticket = await prismaClient.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, workspaceId: true },
      });

      if (!ticket) {
        res.status(404).json({ error: `Ticket ${ticketId} not found`, code: 'TICKET_NOT_FOUND' });
        return;
      }

      // Update ticket emailReplyEnabled column
      await prismaClient.ticket.update({
        where: { id: ticketId },
        data: { emailReplyEnabled: true },
      });

      logger.info(`[TicketController] Enabled email reply for ticket ${ticketId}`);

      res.status(200).json({ success: true, ticketId, emailReplyEnabled: true });
    } catch (error) {
      logger.error('[TicketController] Error enabling email send:', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };

  /**
   * Create an email-type ticket in Xyne Desk on behalf of an external sender.
   * Ticket appears as an email thread identical to Gmail-ingested tickets.
   * POST /api/apps/ticket/createEmailTicket
   *
   * Body: { channelId, subject, body, senderEmail, boardId? }
   */
  createEmailTicket = async (req: Request, res: Response): Promise<void> => {
    try {
      const bodyResult = CreateEmailTicketBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors,
        });
        return;
      }

      const {
        channelId,
        subject,
        body,
        senderEmail,
        boardId,
        priority,
        assignedToEmail,
        assignedUserGroupAlias,
        stageName,
        ticketType,
      } = bodyResult.data;

      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId;

      const channel = await repositories.channels.findById(channelId);
      if (!channel) {
        res.status(404).json({ error: `Channel with ID ${channelId} not found`, code: 'CHANNEL_NOT_FOUND' });
        return;
      }

      const channelPref = await prismaClient.emailChannelPreference.findUnique({
        where: { channelId },
        select: { sendAsEmail: true, ownerUserId: true, boardId: true, deskType: true },
      });

      const boardIdToConfigure = boardId || undefined;

      if (boardIdToConfigure) {
        const board = await prismaClient.board.findUnique({
          where: { id: boardIdToConfigure },
          select: { id: true, projectId: true },
        });
        if (!board) {
          res.status(404).json({
            error: `Board with ID ${boardIdToConfigure} not found`,
            code: 'BOARD_NOT_FOUND',
          });
          return;
        }
        await emailChannelPreferenceRepo.upsert({
          channelId,
          deskType: (channelPref?.deskType ?? DeskType.EMAIL) as DeskType,
          boardId: boardIdToConfigure,
        });
      }

      const effectiveBoardId = boardIdToConfigure || channelPref?.boardId;
      if (!effectiveBoardId) {
        res.status(503).json({
          error:
            'Email desk board is not configured. Set email_channel_preferences.boardId or pass boardId in the request body.',
          code: 'MISCONFIGURED',
        });
        return;
      }

      // Resolve recipientEmail using same 3-level priority as outbound reply sender:
      //   1. EmailChannelPreference.sendAsEmail — admin-configured alias (highest priority)
      //   2. ExternalSource.displayName — connected mailbox from OAuth integration
      //   3. Desk owner's user email — last-resort fallback
      const externalSource = await externalSourceRepo.findChannelSource(channelId, {
        sourceTypes: ['google', 'microsoft'],
      });
      const ownerUser = channelPref?.ownerUserId
        ? await repositories.users.findById(channelPref.ownerUserId)
        : null;

      const recipientEmail =
        channelPref?.sendAsEmail ||
        extractEmailAddress(externalSource?.displayName ?? '') ||
        ownerUser?.email;

      if (!recipientEmail) {
        res.status(503).json({
          error: 'Channel recipient email is not configured',
          code: 'MISCONFIGURED',
        });
        return;
      }

      // Resolve assignedToEmail → userId (same as createTicket)
      let assignedTo: string | undefined;
      if (assignedToEmail) {
        const user = await repositories.users.findByEmail(assignedToEmail, workspaceId);
        if (!user) {
          res.status(404).json({ error: `User with email ${assignedToEmail} not found`, code: 'USER_NOT_FOUND' });
          return;
        }
        assignedTo = user.id;
      }

      // Resolve assignedUserGroupAlias → userGroupId (same as createTicket)
      let userGroupId: string | undefined;
      if (assignedUserGroupAlias) {
        const userGroup = await repositories.userGroups.findByAlias(assignedUserGroupAlias, workspaceId);
        if (!userGroup) {
          res.status(404).json({ error: `User group with alias ${assignedUserGroupAlias} not found`, code: 'USER_GROUP_NOT_FOUND' });
          return;
        }
        userGroupId = userGroup.id;
      }

      let pendingFullRoleAssignment = false;
      let resolvedAssignedTo = assignedTo;

      // Avoid UUID→provider thread ID races with webhooks:
      // 1) send acknowledgment email first and claim the provider thread immediately,
      // 2) create the desk ticket with real external IDs,
      // 3) link ExternalMessage to the Email row.
      let externalThreadId: string;
      let externalMessageId: string;
      let claimedExternalMessageId: string | undefined;

      const mailAdapter = externalSource ? adapterRegistry.getAdapter(externalSource.name) : null;
      const canSendViaProvider = !!(externalSource && mailAdapter?.sendMailNew);

      if (canSendViaProvider) {
        const acknowledgmentBody = buildEmailTicketAcknowledgmentBody(subject, body);
        let sent: { threadId: string; messageId?: string };
        try {
          sent = await mailAdapter!.sendMailNew!({
            encryptedCredentials: externalSource!.credentials,
            sourceId: externalSource!.id,
            subject,
            body: acknowledgmentBody,
            to: [senderEmail],
            cc: [],
            bcc: [],
            fromEmailAddress: recipientEmail,
          });
        } catch (sendErr) {
          logger.error('[Apps Email Ticket Creation] Failed to send acknowledgment email:', sendErr);
          res.status(502).json({
            error: 'Failed to send initial email via provider',
            code: 'EMAIL_SEND_FAILED',
          });
          return;
        }

        externalThreadId = sent.threadId;
        externalMessageId = sent.messageId || sent.threadId;

        // Claim thread before ticket creation so Gmail/MS webhooks dedupe instead of
        // spawning a second ticket while we persist the conversation.
        try {
          const claimed = await prismaClient.externalMessage.create({
            data: {
              externalSourceId: externalSource!.id,
              externalId: externalMessageId,
              externalThreadId,
              messageId: externalMessageId,
              direction: MessageDirection.OUTGOING,
              entityType: ExternalEntityType.EMAIL,
              workspaceId,
            },
          });
          claimedExternalMessageId = claimed.id;
        } catch (claimErr) {
          if (
            claimErr instanceof Prisma.PrismaClientKnownRequestError &&
            claimErr.code === 'P2002'
          ) {
            res.status(409).json({ error: 'Duplicate ticket', code: 'DUPLICATE' });
            return;
          }
          throw claimErr;
        }
      } else {
        if (externalSource) {
          logger.warn(
            `[Apps Email Ticket Creation] Adapter "${externalSource.name}" does not support sendMailNew — using local-only thread ids`,
          );
        }
        const { randomUUID } = await import('crypto');
        externalThreadId = randomUUID();
        externalMessageId = externalThreadId;
      }

      let result: Awaited<ReturnType<typeof emailService.createConversationWithEmail>>;
      try {
        result = await emailService.createConversationWithEmail({
          channelId,
          userId,
          emailSubject: subject,
          emailBody: body,
          emailFrom: senderEmail,
          emailTo: [recipientEmail],
          externalThreadId,
          externalMessageId,
          ticketMetadata: {
            reporterEmail: extractEmailAddress(senderEmail) ?? senderEmail.trim().toLowerCase(),
            fromEmailAddress: senderEmail,
          },
          receivedAt: new Date(),
          emailType: EmailType.COMPOSE,
          sentByUserId: userId,
          ...(effectiveBoardId && { boardId: effectiveBoardId }),
        });
      } catch (createErr) {
        if (claimedExternalMessageId) {
          await prismaClient.externalMessage
            .delete({ where: { id: claimedExternalMessageId } })
            .catch(cleanupErr => {
              logger.warn('[Apps Email Ticket Creation] Failed to release thread claim after create error', {
                claimedExternalMessageId,
                cleanupErr,
              });
            });
        }
        throw createErr;
      }

      if (result && 'blocked' in result && result.blocked) {
        if (claimedExternalMessageId) {
          await prismaClient.externalMessage
            .delete({ where: { id: claimedExternalMessageId } })
            .catch(() => undefined);
        }
        res.status(403).json({ error: 'Ticket creation blocked by configuration', code: 'BLOCKED' });
        return;
      }

      if (result && 'isDuplicate' in result && result.isDuplicate) {
        res.status(409).json({ error: 'Duplicate ticket', code: 'DUPLICATE' });
        return;
      }

      const { ticket, conversation, email: initialEmail } = result as { ticket: any; conversation: any; email: any };

      // Audit trail + desk metrics: outbound compose counts as an agent send.
      await emailService.recordEmailSentActivity(
        conversation.conversationId,
        initialEmail.id,
        EmailType.COMPOSE,
        userId,
        initialEmail.createdAt,
      );

      if (claimedExternalMessageId) {
        await prismaClient.externalMessage.update({
          where: { id: claimedExternalMessageId },
          data: {
            entityId: initialEmail.id,
            messageId: initialEmail.id,
          },
        });
        logger.info(
          `[Apps Email Ticket Creation] Acknowledgment sent, threadId=${externalThreadId} ticket=${ticket.id}`,
        );
      }

      // Duplicate detection runs inside emailService.createConversationWithEmail.

      // Apply optional fields to the created ticket
      if (priority !== undefined || resolvedAssignedTo !== undefined || userGroupId !== undefined || stageName !== undefined || ticketType !== undefined) {
        const ticketUpdate: Record<string, unknown> = {};

        if (priority !== undefined) ticketUpdate.priority = priority;
        if (resolvedAssignedTo !== undefined) ticketUpdate.assignedTo = resolvedAssignedTo;
        if (userGroupId !== undefined) ticketUpdate.userGroupId = userGroupId;
        if (ticketType !== undefined) ticketUpdate.ticketType = ticketType;

        if (stageName !== undefined) {
          const stage = await prismaClient.stage.findFirst({
            where: { boardId: ticket.boardId, name: stageName },
            select: { name: true },
          });
          if (!stage) {
            res.status(400).json({
              error: `Stage "${stageName}" does not exist on board ${ticket.boardId}`,
              code: 'STAGE_NOT_FOUND',
            });
            return;
          }
          ticketUpdate.stageName = stage.name;
        }

        if (Object.keys(ticketUpdate).length > 0) {
          const updatedTicket = await prismaClient.ticket.update({
            where: { id: ticket.id },
            data: ticketUpdate,
          });
          await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
        }
      }

      // Full role assignment
      if (userGroupId && !assignedTo) {
        try {
          const boardRow = await prismaClient.board.findUnique({
            where: { id: ticket.boardId },
            select: { metadata: true },
          });
          const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

          if (boardMetadata?.fullRoleAssignment === true) {
            pendingFullRoleAssignment = true;
          } else {
            const assignmentResult = await evaluateAssignmentRule(userGroupId, ticket.boardId, undefined, undefined, ticket.projectId);
            if (assignmentResult.assignedUserId) {
              resolvedAssignedTo = assignmentResult.assignedUserId;
              const updatedTicket = await prismaClient.ticket.update({
                where: { id: ticket.id },
                data: { assignedTo: resolvedAssignedTo },
              });
              await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
            }
          }
        } catch (error) {
          logger.error('[Apps Email Ticket Creation] Error during auto-assignment:', error);
        }
      }

      if (pendingFullRoleAssignment && userGroupId && ticket.id) {
        try {
          const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
            ticketId: ticket.id,
            userGroupId,
            boardId: ticket.boardId,
            createdBy: userId,
            projectId: ticket.projectId,
          });
          const primaryUserId = primaryUserIdOf(fullRoles);
          if (primaryUserId) {
            const updatedTicket = await prismaClient.ticket.update({
              where: { id: ticket.id },
              data: { assignedTo: primaryUserId },
            });
            await syncConversationTicketMdFromPrismaTicket(prismaClient, updatedTicket);
          }
        } catch (error) {
          logger.error('[Apps Email Ticket Creation] Error during full role assignment:', error);
        }
      }

      res.status(201).json({
        ticketId: ticket?.id,
        xyneId: ticket?.xyneId,
        conversationId: conversation?.conversationId,
      });
    } catch (error) {
      logger.error('[TicketController] createEmailTicket error:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('No stages found')) {
          res.status(404).json({ error: error.message, code: 'NOT_FOUND' });
          return;
        }
        if (error.message.includes('boardId configured') || error.message.includes('not configured')) {
          res.status(503).json({ error: error.message, code: 'MISCONFIGURED' });
          return;
        }
      }

      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };

  appDeskInbound = async (req: Request, res: Response): Promise<void> => {
    try {
      const additionalFormFieldValidationErrors: Array<{ error: string; code: 'VALIDATION_ERROR' }> = [];

      if (typeof req.body.additionalFormFields === 'string') {
        try {
          req.body.additionalFormFields = JSON.parse(req.body.additionalFormFields);
        } catch {
          additionalFormFieldValidationErrors.push({
            error: 'additionalFormFields must be valid JSON',
            code: 'VALIDATION_ERROR',
          });
          delete req.body.additionalFormFields;
        }
      }

      const bodyResult = AppDeskInboundBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: bodyResult.error.errors });
        return;
      }

      const {
        channelId, threadId, externalId: bodyExternalId, subject, body,
        senderEmail, senderName,
        additionalFormFields,
      } = bodyResult.data;

      const userId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;

      const reqFiles = (req.files && !Array.isArray(req.files))
        ? (req.files as Record<string, Express.Multer.File[]>)
        : {};
      const files = reqFiles['files'] ?? [];
      const emailBody = body ?? '';
      if (!emailBody && files.length === 0) {
        res.status(400).json({ error: 'body or at least one file is required', code: 'VALIDATION_ERROR' });
        return;
      }

      const channel = await repositories.channels.findById(channelId);
      if (!channel) {
        res.status(404).json({ error: `Channel with ID ${channelId} not found`, code: 'CHANNEL_NOT_FOUND' });
        return;
      }

      const channelPref = await prismaClient.emailChannelPreference.findUnique({
        where: { channelId },
        select: { sendAsEmail: true, ownerUserId: true, boardId: true },
      });
      if (!channelPref || !isDeskChannelType(channel.type)) {
        res.status(400).json({ error: 'Channel is not a desk channel', code: 'NOT_DESK_CHANNEL' });
        return;
      }

      const installedAppId = (req as any).auth?.installedAppId as string | undefined;
      if (!installedAppId) {
        res.status(403).json({ error: 'App identity not established', code: 'APP_NOT_CONNECTED' });
        return;
      }
      const externalSource = await externalSourceRepo.findChannelAppSource(channelId, installedAppId);
      if (!externalSource) {
        res.status(403).json({ error: 'App is not connected to this channel', code: 'APP_NOT_CONNECTED' });
        return;
      }
      if (!externalSource.isActive) {
        res.status(409).json({ error: 'App desk is disconnected', code: 'DESK_DISCONNECTED' });
        return;
      }

      const externalThreadId = threadId;
      const appExternalId = bodyExternalId || randomUUID();
      // Source-namespaced, and written to BOTH Email.externalMessageId and
      // ExternalMessage.externalId. Those two columns are the same identifier
      // throughout this repo (core.ts writes normalizedData.externalId to both,
      // emailService.ts:2517 copies one into the other), and joins rely on that —
      // so the namespace has to be applied on both sides or not at all. Applying it
      // is what stops two apps on one channel from colliding on a shared id, since
      // Email's unique is (externalMessageId, channelId) and the id is app-chosen.
      const externalMessageId = scopeExternalMessageIdToSource(externalSource.id, appExternalId);

      let customFieldValues: CustomFieldWritePayload | undefined;
      let emailFrom =
        (senderName && senderEmail && `${senderName} <${senderEmail}>`) ||
        senderName ||
        senderEmail ||
        '';
      if (!emailFrom) {
        const botUser = await repositories.users.findById(userId);
        emailFrom = botUser?.email
          ? `${botUser.name} <${botUser.email}>`
          : botUser?.name ?? 'External user';
      }
      const uploadedFiles = files.length > 0 ? await uploadFiles(files) : [];

      const ownerUser = channelPref.ownerUserId ? await repositories.users.findById(channelPref.ownerUserId) : null;
      // The desk's own address comes from its mailbox source, never from the app
      // binding — an app-desk displayName is the app's name and holds no address, so
      // reading it here would skip a perfectly good mailbox for the owner's personal
      // address on any EMAIL desk without sendAsEmail.
      const mailboxSource = await externalSourceRepo.findChannelSource(channelId, {
        sourceTypes: ['google', 'microsoft', 'zoho'],
      });
      const recipientEmail =
        channelPref.sendAsEmail ||
        extractEmailAddress(mailboxSource?.displayName ?? '') ||
        ownerUser?.email ||
        `desk-${channelId}@apps.xyne.ai`;

      logger.info('[AppDeskInbound] received', {
        channelId,
        threadId: externalThreadId,
        externalId: appExternalId,
        externalMessageId,
        externalIdProvided: !!bodyExternalId,
        from: emailFrom,
        recipientEmail,
        hasBody: emailBody.length > 0,
        fileCount: uploadedFiles.length,
        appUserId: userId,
      });

      // Thread continuation is source-scoped via the app's ExternalMessage link; the
      // channel-scoped fallback only covers pre-existing threads with a missing link
      // (self-healed by the externalSourceLink write below). Do not remove the fallback.
      const linkedMessage = await externalMessageRepo.findByThreadId(externalSource.id, externalThreadId, ExternalEntityType.EMAIL);
      let threadEmail = linkedMessage?.entityId ? await repositories.emails.findById(linkedMessage.entityId) : null;
      if (threadEmail) {
        const { email } = await emailService.addEmailToConversation({
          conversationId: threadEmail.conversationId,
          emailSubject: subject,
          emailBody,
          emailTo: [recipientEmail],
          emailFrom,
          externalSourceId: externalSource.id,
          externalThreadId,
          externalMessageId,
          emailType: EmailType.DEFAULT,
          ...(uploadedFiles.length > 0 && { uploadedFiles }),
          receivedAt: new Date(),
        });
        const existingTicket = await prismaClient.ticket.findFirst({
          where: { conversationId: threadEmail.conversationId },
          select: { id: true, xyneId: true, boardId: true },
        });

        if (additionalFormFields && existingTicket?.id) {
          if (!existingTicket.boardId) {
            additionalFormFieldValidationErrors.push({
              error: 'Ticket board is not configured for additional form fields',
              code: 'VALIDATION_ERROR',
            });
          } else {
            const partialResult = await buildPartialCustomFieldWritePayload(
                existingTicket.boardId,
                workspaceId,
                additionalFormFields,
                { requireAllRequiredFields: false },
              );
            customFieldValues = partialResult.customFieldValues;
            additionalFormFieldValidationErrors.push(...partialResult.validationErrors);

            if (customFieldValues && customFieldValues.fieldValues.length > 0) {
              await syncCustomFieldValues(existingTicket.id, customFieldValues, userId);
            }
          }
        }

        logger.info('[AppDeskInbound] appended message to existing thread', {
          threadId: externalThreadId,
          conversationId: threadEmail.conversationId,
          emailId: email.id,
          ticketId: existingTicket?.id,
          xyneId: existingTicket?.xyneId,
          fileCount: uploadedFiles.length,
          additionalFormFieldsCount: additionalFormFields ? Object.keys(additionalFormFields).length : 0,
        });
        res.status(200).json({
          ticketId: existingTicket?.id,
          xyneId: existingTicket?.xyneId,
          conversationId: threadEmail.conversationId,
          isNew: false,
          ...(additionalFormFieldValidationErrors.length > 0 && {
            validationErrors: additionalFormFieldValidationErrors,
          }),
        });
        return;
      }

      const effectiveBoardId = channelPref.boardId || undefined;
      if (!effectiveBoardId) {
        res.status(503).json({ error: 'App desk board is not configured', code: 'MISCONFIGURED' });
        return;
      }

      if (additionalFormFields) {
        const partialResult = await buildPartialCustomFieldWritePayload(
          effectiveBoardId,
          workspaceId,
          additionalFormFields,
        );
        customFieldValues = partialResult.customFieldValues;
        additionalFormFieldValidationErrors.push(...partialResult.validationErrors);
      }

      const result = await emailService.createConversationWithEmail({
        channelId,
        userId,
        emailSubject: subject,
        emailBody,
        emailFrom,
        emailTo: [recipientEmail],
        externalSourceId: externalSource.id,
        externalThreadId,
        externalMessageId,
        ...(uploadedFiles.length > 0 && { uploadedFiles }),
        ticketMetadata: {
          deskSource: {
            type: 'app',
            installedAppId,
            appName: externalSource.displayName ?? installedAppId,
          },
          ...(senderEmail && {
            reporterEmail: extractEmailAddress(senderEmail) ?? senderEmail.trim().toLowerCase(),
            fromEmailAddress: senderEmail,
          }),
        },
        receivedAt: new Date(),
        boardId: effectiveBoardId,
      });

      if (result && 'blocked' in result && result.blocked) {
        res.status(403).json({ error: 'Ticket creation blocked by configuration', code: 'BLOCKED' });
        return;
      }
      if (result && 'isDuplicate' in result && result.isDuplicate) {
        res.status(409).json({ error: 'Duplicate ticket', code: 'DUPLICATE' });
        return;
      }

      const { ticket, conversation, email: initialEmail } = result as { ticket: any; conversation: any; email: any };

      if (customFieldValues && customFieldValues.fieldValues.length > 0 && ticket?.id) {
        await syncCustomFieldValues(ticket.id, customFieldValues, userId);
      }

      logger.info('[AppDeskInbound] created new ticket', {
        threadId: externalThreadId,
        ticketId: ticket?.id,
        xyneId: ticket?.xyneId,
        conversationId: conversation?.conversationId,
        emailId: initialEmail?.id,
        boardId: effectiveBoardId,
        fileCount: uploadedFiles.length,
        additionalFormFieldsCount: additionalFormFields ? Object.keys(additionalFormFields).length : 0,
      });

      res.status(201).json({
        ticketId: ticket?.id,
        xyneId: ticket?.xyneId,
        conversationId: conversation?.conversationId,
        isNew: true,
        ...(additionalFormFieldValidationErrors.length > 0 && {
          validationErrors: additionalFormFieldValidationErrors,
        }),
      });
    } catch (error) {
      logger.error('[TicketController] appDeskInbound error:', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  };

}
