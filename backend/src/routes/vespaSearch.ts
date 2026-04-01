import { Router } from 'express';
import { searchHandler } from '../services/vespaSearch';
import { validateQuery, validateSearchFilters } from '../middleware/validation';
import { vespaSearchQuerySchema } from '../validators/vespaSearchValidator';

const router = Router();

/**
 * @route GET /api/vespaSearch
 * @desc Vespa search across all indexed documents
 * @access Private
 * @param {string} q - Search query (required)
 * @param {string} apps - Comma-separated apps to search: chat,ticket,user,file,gmail (optional, default: chat,ticket,user,file)
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
 */
router.get('/', validateQuery(vespaSearchQuerySchema), validateSearchFilters(), searchHandler);

export default router;
