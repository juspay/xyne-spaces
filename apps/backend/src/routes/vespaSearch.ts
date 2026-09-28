import { Router } from 'express';
import { searchHandler } from '../services/vespaSearch';
import { validateQuery, validateSearchFilters } from '../middleware/validation';
import {
  vespaSearchQuerySchema,
  vespaSchemaQuerySchema,
  queryIntentQuerySchema,
} from '../validators/vespaSearchValidator';
import { schemaHandler } from '../services/vespaSearch/schemaHandler';
import { queryIntentHandler } from '../services/queryIntent/handler';

const router = Router();

/**
 * @route GET /api/vespaSearch
 * @desc Vespa search across all indexed documents
 * @access Private
 * @param {string} q - Search query (required)
 * @param {string} apps - Comma-separated apps to search: slack,ticket,user (optional, default: slack,ticket,user)
 * @param {number} offset - Pagination offset (optional, default: 0)
 * @param {number} limit - Results per page (optional, default: 20, max: 100)
 * @param {string} rankProfile - Vespa rank profile to use (optional)
 * @param {string} type - Filter by type: messages|attachments|channels|tickets (optional)
 * @param {string} from - Filter by user ID(s) - comma-separated (optional)
 * @param {string} in - Filter by channel ID(s) - comma-separated (optional)
 * @param {string} projectId - Filter by project ID(s) - comma-separated (optional)
 * @param {string} status - Filter by ticket status(es) - comma-separated (optional)
 * @param {string} ticketId - Filter by specific ticket ID(s) - comma-separated (optional)
 * @param {string} priority - Filter by priority: HIGH|MEDIUM|LOW|CRITICAL (optional)
 * @param {string} board - Filter by board name (optional)
 * @param {string} tags - Filter by tags - comma-separated (optional)
 * @param {string} before - Created before date (optional)
 * @param {string} after - Created after date (optional)
 * @param {string} on - Created on specific date (optional)
 * @param {string} range - Time keyword filter (optional)
 * @param {string} stage - Filter by ticket stage (optional)
 * @param {string} assignee - Filter by assigned user ID (optional)
 * @param {boolean} filterOnly - Enable filter-only mode (no query text required) (optional)
 * @param {boolean} includeDebugInfo - Include debug info in response (optional)
 * @param {boolean} searchId - searchId (optional)
 * @param {string} presentationSummary - Vespa presentation.summary profile, e.g. "lean" (optional, defaults to "lean")
 */
router.get('/', validateQuery(vespaSearchQuerySchema), validateSearchFilters(), searchHandler);

/**
 * @route GET /api/vespaSearch/schema
 * @desc Returns the raw Vespa .sd schema definition for the requested schema.
 *       Used by the AI agent to discover available fields before building YQL queries.
 * @access Private
 * @param {string} schema - Required. One of: chat_message, chat_attachment, chat_container,
 *                          ticket, user, file, sam_transcript, mail, mail_attachment, project, memory
 */
router.get('/schema', validateQuery(vespaSchemaQuerySchema), schemaHandler);

/**
 * @route GET /api/vespaSearch/intent
 * @desc Classifies a cmd+K query as a keyword lookup ('lexical') or a question that needs
 *       AI ('ai'). Called alongside search, never inside it, so a slow classifier can't
 *       delay results. `data` is null when there is no verdict (feature off, clearly
 *       lexical, or the classifier failed); the client treats that as lexical.
 * @access Private
 * @param {string} q - The query text (required)
 */
router.get('/intent', validateQuery(queryIntentQuerySchema), queryIntentHandler);

export default router;
