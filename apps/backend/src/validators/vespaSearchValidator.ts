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
    .pattern(/^(chat|ticket|user|file|collection|mail|xyneapp|call)(,(chat|ticket|user|file|collection|mail|xyneapp|call))*$/)
    .default('chat,ticket,user,file,mail')
    .messages({
      'string.pattern.base': 'Apps must be comma-separated values from: chat, ticket, user, file, collection, mail, xyneapp, call'
    }),

  // Pagination
  offset: Joi.number().integer().min(0).max(1000).default(0).messages({
    'number.base': 'Offset must be a number',
    'number.integer': 'Offset must be an integer',
    'number.min': 'Offset cannot be negative',
    'number.max': 'Offset cannot exceed 1000',
  }),

  limit: Joi.number().integer().min(1).max(200).default(20).messages({
    'number.base': 'Limit must be a number',
    'number.integer': 'Limit must be an integer',
    'number.min': 'Limit must be at least 1',
    'number.max': 'Limit cannot exceed 200'
  }),

  // Rank profile
  rankProfile: Joi.string().optional().messages({
    'string.base': 'Rank profile must be a string'
  }),

  // Frontend-compatible filters (includes subApp types: canvas, transcript, rca)
  // Supports comma-separated values: messages,files or canvas,transcript
  type: Joi.string()
    .pattern(/^(messages|attachments|calls|channels|tickets|users|files|canvas|transcript|rca|people|emails)(,(messages|attachments|calls|channels|tickets|users|files|canvas|transcript|rca|people|emails))*$/)
    .optional()
    .messages({
      'string.pattern.base': 'Type must be comma-separated values of: messages, attachments, calls, channels, tickets, users, files, canvas, transcript, rca, people, emails, calls'
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

  fromEmail: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((email: string) => email.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'fromEmail must be a string or array of email addresses'
    }),

  toEmail: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((email: string) => email.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'toEmail must be a string or array of email addresses'
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

  // Mention filter (scoped search): messages that mention these user IDs (Vespa `mentions` field)
  mentions: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'mentions must be a string or array of user IDs'
    }),

  // Channel-mention filter (scoped search): messages that reference these channel IDs (Vespa `channelMentions` field)
  channelMentions: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'channelMentions must be a string or array of channel IDs'
    }),

  // Highlight-only mention display name(s); JSON-encoded array since names can contain commas.
  mentionHighlights: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed.map((v: unknown) => String(v)) : [value];
        } catch {
          return [value];
        }
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'mentionHighlights must be a string or array of display names'
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

  // Thread classification. threadType matches a thread's ROOT message (one hit per thread);
  // messageActs matches the individual messages cited as evidence for a type.
  threadType: Joi.string().optional().messages({
    'string.base': 'threadType must be a comma-separated string'
  }),

  messageActs: Joi.string().optional().messages({
    'string.base': 'messageActs must be a comma-separated string'
  }),

  dynamicFieldValues: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((item: string) => item.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'dynamicFieldValues must be a string or array'
    }),

  dynamicFieldDateRanges: Joi.string().optional().messages({
    'string.base': 'dynamicFieldDateRanges must be a JSON string'
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

  callStatus: Joi.string().optional().messages({
    'string.base': 'callStatus must be a comma-separated string'
  }),

  callStartsAt: Joi.number().integer().min(0).optional().messages({
    'number.base': 'callStartsAt must be a timestamp',
    'number.integer': 'callStartsAt must be an integer timestamp',
    'number.min': 'callStartsAt cannot be negative'
  }),

  callEndsAt: Joi.number().integer().min(0).optional().messages({
    'number.base': 'callEndsAt must be a timestamp',
    'number.integer': 'callEndsAt must be an integer timestamp',
    'number.min': 'callEndsAt cannot be negative'
  }),

  stage: Joi.string().optional().messages({
    'string.base': 'Stage must be a string'
  }),

  assignee: Joi.string().optional().messages({
    'string.base': 'Assignee must be a string'
  }),

  subApp: Joi.string().valid('canvas', 'transcript', 'recording', 'rca', 'collections').optional().messages({
    'string.base': 'SubApp must be a string',
    'any.only': 'SubApp must be one of: canvas, transcript, recording, rca, collections'
  }),

  // Restrict file results to one or more knowledge-base collections (matches clId in Vespa).
  // Used by claw-auth's kb-search to scope Vespa search to an agent's allowed KB collections.
  collectionId: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'collectionId must be a string or array of collection IDs'
    }),

  // Restrict file results to one or more specific document ids (matches Vespa
  // `docId` on the file schema — which for collection items is collectionItem.fileId).
  // Used by claw-auth's kb-search when an agent's grants are all single-file
  // (so Vespa ranks only over in-scope docs instead of pre-fetching siblings).
  fileId: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
        return value.split(',').map((id: string) => id.trim()).filter(Boolean);
      })
    )
    .optional()
    .messages({
      'alternatives.types': 'fileId must be a string or array of file IDs'
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

  // Cmd-K "Include my channels" toggle. When true, scope chat results to channels the user is a member of.
  onlyMyChannels: Joi.string().valid('true', 'false').optional().messages({
    'any.only': 'onlyMyChannels must be "true" or "false"'
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

  // Sort order for results. newest/oldest sort by document timestamp; relevance uses Vespa ranking.
  // When newest/oldest is set, grouping is disabled automatically (flat ranked list).
  orderBy: Joi.string().valid('newest', 'oldest', 'relevance').optional().messages({
    'any.only': 'orderBy must be one of: newest, oldest, relevance'
  }),

  // xyne-apps catalog view (apps=xyneapp). Scopes search to one of the three tabs.
  view: Joi.string().valid('installed', 'org', 'marketplace').optional().messages({
    'any.only': 'view must be one of: installed, org, marketplace'
  }),

  // Chunk-level KB drill-in (opt-in). Used by claw-auth's kb-get-chunks /
  // kb-search-within-doc tools. When 'true' AND fileId is set, the handler
  // short-circuits the normal pipeline and emits raw chunk-level data.
  includeChunkLevel: Joi.string().valid('true', 'false').optional().messages({
    'any.only': 'includeChunkLevel must be "true" or "false"'
  }),
  startChunkIndex: Joi.number().integer().min(0).optional().messages({
    'number.base': 'startChunkIndex must be a number',
    'number.integer': 'startChunkIndex must be an integer',
    'number.min': 'startChunkIndex cannot be negative'
  }),
  chunkLimit: Joi.number().integer().min(1).max(30).optional().messages({
    'number.base': 'chunkLimit must be a number',
    'number.integer': 'chunkLimit must be an integer',
    'number.min': 'chunkLimit must be at least 1',
    'number.max': 'chunkLimit cannot exceed 30'
  }),
}).messages({
  'object.unknown': 'Unknown query parameter: {{#label}}'
});

export const vespaSchemaQuerySchema = Joi.object({
  schema: Joi.string()
    .valid(
      'chat_message', 'chat_attachment', 'chat_container',
      'ticket', 'user', 'file', 'sam_transcript',
      'mail', 'mail_attachment', 'project', 'memory', 'call',
    )
    .required()
    .messages({
      'any.only': 'schema must be one of: chat_message, chat_attachment, chat_container, ticket, user, file, sam_transcript, mail, mail_attachment, project, memory, call',
      'any.required': 'Query parameter "schema" is required',
    }),
}).messages({
  'object.unknown': 'Unknown query parameter: {{#label}}',
});
