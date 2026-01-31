import { Router } from 'express';
import { searchHandler } from '../services/vespaSearch';
import { validateQuery } from '../middleware/validation';
import { vespaSearchQuerySchema } from '../validators/vespaSearchValidator';

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
 * @param {string} docType - Filter by document type(s) - comma-separated (optional)
 * @param {string} senderId - Filter by sender ID(s) - comma-separated (optional)
 * @param {string} groupId - Filter by user group ID(s) - comma-separated (optional)
 * @param {string} status - Filter by ticket status(es) - comma-separated (optional)
 * @param {string} ticketId - Filter by specific ticket ID(s) - comma-separated (optional)
 * @param {boolean} includeDebugInfo - Include debug info in response (optional)
 * @param {boolean} searchId - searchId (optional)
 */
router.get('/', validateQuery(vespaSearchQuerySchema), searchHandler);

export default router;
