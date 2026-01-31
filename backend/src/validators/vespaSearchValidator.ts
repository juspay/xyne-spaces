import Joi from 'joi';

/**
 * Validation schema for Vespa search queries
 * 
 * Supports both frontend-friendly filters (type, from, in) and
 * unified backend filters (channelId, projectId, docType, etc.)
 */
export const vespaSearchQuerySchema = Joi.object({
  // Required query parameter
  q: Joi.string().min(1).max(500).required().messages({
    'string.empty': 'Search query cannot be empty',
    'string.min': 'Search query must be at least 1 character',
    'string.max': 'Search query cannot exceed 500 characters',
    'any.required': 'Query parameter "q" is required'
  }),

  // Apps to search (comma-separated)
  apps: Joi.string()
    .pattern(/^(chat|ticket|user)(,(chat|ticket|user))*$/)
    .default('chat,ticket,user')
    .messages({
      'string.pattern.base': 'Apps must be comma-separated values from: chat, ticket, user'
    }),

  // Pagination
  offset: Joi.number().integer().min(0).default(0).messages({
    'number.base': 'Offset must be a number',
    'number.integer': 'Offset must be an integer',
    'number.min': 'Offset cannot be negative'
  }),

  limit: Joi.number().integer().min(1).max(200).default(20).messages({
    'number.base': 'Limit must be a number',
    'number.integer': 'Limit must be an integer',
    'number.min': 'Limit must be at least 1',
    'number.max': 'Limit cannot exceed 100'
  }),

  // Rank profile
  rankProfile: Joi.string().optional().messages({
    'string.base': 'Rank profile must be a string'
  }),

  // Frontend-compatible filters
  type: Joi.string()
    .valid('messages', 'attachments', 'channels', 'tickets')
    .optional()
    .messages({
      'any.only': 'Type must be one of: messages, attachments, channels, tickets'
    }),

  from: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'From must be a string or array of user IDs'
    }),

  in: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'In must be a string or array of channel IDs'
    }),

  // Unified filters (work for both slack and ticket)
  channelId: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'Channel ID must be a string or array'
    }),

  projectId: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'Project ID must be a string or array'
    }),

  docType: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'Document type must be a string or array'
    }),

  senderId: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'Sender ID must be a string or array'
    }),

  // Ticket-specific filters
  groupId: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'Group ID must be a string or array'
    }),

  status: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'Status must be a string or array'
    }),

  ticketId: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'Ticket ID must be a string or array'
    }),

  // Debug flag
  includeDebugInfo: Joi.boolean().optional().messages({
    'boolean.base': 'Include debug info must be a boolean'
  }),
  searchId: Joi.string().optional().messages({
    'string.base': 'Search ID must be a string'
  }),
}).messages({
  'object.unknown': 'Unknown query parameter: {{#label}}'
});
