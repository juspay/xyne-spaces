import Joi from 'joi';
import { MAX_BULK_TICKETS } from '@/types/bulkTicket';

const etaSchema = Joi.date().allow(null).messages({
  'date.base': 'ETA must be a valid date',
  'any.invalid': 'ETA must be a valid date or null',
});

const subTicketSchema = Joi.object({
  title: Joi.string().trim().min(1).max(500).required(),
  description: Joi.string().trim().allow('').max(4000).optional(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').optional(),
  statusV2: Joi.string().valid('TODO', 'STARTED', 'PAUSED', 'CANCELLED', 'COMPLETED').optional(),
  eta: etaSchema.optional(),
  channelId: Joi.string().required(),
  boardId: Joi.string().optional(),
  projectId: Joi.string().optional(),
  assignedTo: Joi.string().allow(null).optional(),
  userGroupId: Joi.string().allow(null).optional(),
  ticketType: Joi.string().optional(),
  stageName: Joi.string().optional(),
  merchantId: Joi.string().optional(),
  clientRowId: Joi.string().optional(),
});

const bulkTicketSchema = Joi.object({
  title: Joi.string().trim().min(1).max(500).required(),
  description: Joi.string().trim().allow('').max(4000).optional(),
  projectId: Joi.string().optional(),
  boardId: Joi.string().optional(),
  channelId: Joi.string().optional(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').optional(),
  statusV2: Joi.string().valid('TODO', 'STARTED', 'PAUSED', 'CANCELLED', 'COMPLETED').optional(),
  eta: etaSchema.optional(),
  assignedTo: Joi.string().allow(null).optional(),
  userGroupId: Joi.string().allow(null).optional(),
  ticketType: Joi.string().optional(),
  stageName: Joi.string().optional(),
  merchantId: Joi.string().optional(),
  clientRowId: Joi.string().optional(),
});

const parentSchema = bulkTicketSchema.keys({
  projectId: Joi.string().required(),
  boardId: Joi.string().required(),
  channelId: Joi.string().required(),
  description: Joi.string().trim().allow('').max(4000).required(),
});

export const bulkTicketSchemaValidator = Joi.object({
  mode: Joi.string().valid('parent-sub', 'all-parents').default('parent-sub'),
  existingParentTicketId: Joi.string().optional(),
  sourceConversationId: Joi.string().optional(),
  sourceMessageId: Joi.string().optional(),
  parent: parentSchema.optional(),
  subTickets: Joi.array().items(subTicketSchema).max(MAX_BULK_TICKETS).optional(),
  tickets: Joi.array().items(bulkTicketSchema).max(MAX_BULK_TICKETS).optional(),
  projectId: Joi.string().optional(),
  channelId: Joi.string().optional(),
  boardId: Joi.string().optional(),
  fromTicketsTab: Joi.boolean().optional(),
}).or('parent', 'tickets', 'existingParentTicketId');
