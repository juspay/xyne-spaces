import Joi from 'joi';

/**
 * Validation schema for Vespa search queries
 * 
 * Supports both frontend-friendly filters (type, from, in) and
 * unified backend filters (channelId, projectId, docType, etc.)
 */
export const vespaSearchQuerySchema = Joi.object({
  // Required query parameter - allow empty string for filter-only searches
  q: Joi.string().min(0).max(500).allow('').required().messages({
    'string.empty': 'Search query can be empty when using filters',
    'string.min': 'Search query must be at least 0 characters',
    'string.max': 'Search query cannot exceed 500 characters',
    'any.required': 'Query parameter "q" is required'
  }),

  // Apps to search (comma-separated)
  apps: Joi.string()
    .pattern(/^(chat|ticket|user|file|mail)(,(chat|ticket|user|file|mail))*$/)
    .default('chat,ticket,user,file,mail')
    .messages({
      'string.pattern.base': 'Apps must be comma-separated values from: chat, ticket, user, file, mail'
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

  // Frontend-compatible filters (includes subApp types: canvas, transcript, rca)
  // Supports comma-separated values: messages,files or canvas,transcript
  type: Joi.string()
    .pattern(/^(messages|attachments|channels|tickets|users|files|canvas|transcript|rca|people|emails)(,(messages|attachments|channels|tickets|users|files|canvas|transcript|rca|people|emails))*$/)
    .optional()
    .messages({
      'string.pattern.base': 'Type must be comma-separated values of: messages, attachments, channels, tickets, users, files, canvas, transcript, rca, people, emails'
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

  withUser: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'With must be a string or array of user IDs'
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

  // Ticket-specific filters
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

  // Accept any string - validation happens in search handler
  priority: Joi.string().optional(),

  // Accept any string - validation happens in search handler
  created: Joi.string().optional(),

  // New ticket filters
  board: Joi.string().optional().messages({
    'string.base': 'Board must be a string'
  }),

  tags: Joi.string().optional().messages({
    'string.base': 'Tags must be a comma-separated string'
  }),

  before: Joi.string().optional().messages({
    'string.base': 'Before date must be a string'
  }),

  after: Joi.string().optional().messages({
    'string.base': 'After date must be a string'
  }),

  on: Joi.string().optional().messages({
    'string.base': 'On date must be a string'
  }),

  range: Joi.string().optional().messages({
    'string.base': 'Range must be a string (time keyword)'
  }),

  stage: Joi.string().optional().messages({
    'string.base': 'Stage must be a string'
  }),

  assignee: Joi.string().optional().messages({
    'string.base': 'Assignee must be a string'
  }),

  subApp: Joi.string().valid('canvas', 'transcript', 'recording', 'rca').optional().messages({
    'string.base': 'SubApp must be a string',
    'any.only': 'SubApp must be one of: canvas, transcript, recording, rca'
  }),

  callType: Joi.string().optional().messages({
    'string.base': 'callType must be a string'
  }),

  presentationSummary: Joi.string().optional().messages({
    'string.base': 'presentationSummary must be a string'
  }),

  // Filter-only mode flag
  filterOnly: Joi.string().valid('true', 'false').optional().messages({
    'any.only': 'filterOnly must be "true" or "false"'
  }),

  // Cmd-K "Include bot messages" toggle. Default behavior (omitted/false) excludes BOT messages.
  includeBotMessages: Joi.string().valid('true', 'false').optional().messages({
    'any.only': 'includeBotMessages must be "true" or "false"'
  }),

  // Debug flag
  includeDebugInfo: Joi.boolean().optional().messages({
    'boolean.base': 'Include debug info must be a boolean'
  }),
  searchId: Joi.string().optional().messages({
    'string.base': 'Search ID must be a string'
  }),

  // Grouping override. Empty string disables grouping (flat ranked list).
  groupBy: Joi.string().allow('').optional().messages({
    'string.base': 'groupBy must be a string'
  }),
}).messages({
  'object.unknown': 'Unknown query parameter: {{#label}}'
});
