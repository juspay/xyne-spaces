import { Router } from 'express';
import { SearchController } from '../controllers/searchController';
import { validateQuery } from '../middleware/validation';
import Joi from 'joi';

const router = Router();
const searchController = new SearchController();

// Validation schema for search queries
const searchQuerySchema = Joi.object({
  query: Joi.string().min(2).max(500).required(),
  entityTypes: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().valid('users', 'messages', 'channels', 'tickets', 'attachments')),
      Joi.string().custom((value, helpers) => {
        // Parse comma-separated string to array
        const types = value.split(',').map((t: string) => t.trim());
        const validTypes = ['users', 'messages', 'channels', 'tickets', 'attachments'];

        for (const type of types) {
          if (!validTypes.includes(type)) {
            return helpers.error('any.invalid');
          }
        }

        return types;
      })
    )
    .optional(),
  channelIds: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
       
        return value.split(',').map((id: string) => id.trim());
      })
    )
    .optional(),
  userIds: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string()),
      Joi.string().custom((value) => {
  
        return value.split(',').map((id: string) => id.trim());
      })
    )
    .optional(),
  dateRange: Joi.string().custom((value, helpers) => {
    try {
      const parsed = JSON.parse(value);

      // Validate dateRange structure
      if (parsed.from && typeof parsed.from !== 'string') {
        return helpers.error('dateRange.invalidFrom');
      }
      if (parsed.to && typeof parsed.to !== 'string') {
        return helpers.error('dateRange.invalidTo');
      }

      return parsed;
    } catch (err) {
      return helpers.error('dateRange.invalidJSON');
    }
  }).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(25),
  searchType: Joi.string().valid('trigram', 'fts', 'both').optional(),
  sort: Joi.string().valid('relevance', 'newest', 'oldest').optional(),
}).messages({
  'dateRange.invalidJSON': 'Invalid date range JSON format',
  'dateRange.invalidFrom': 'Invalid "from" date in dateRange',
  'dateRange.invalidTo': 'Invalid "to" date in dateRange',
});


/**
 * @route GET /api/search
 * @desc Global search across users, messages, and channels
 * @access Private
 * @param {string} query - Search term (required)
 * @param {string} entityTypes - Comma-separated list of entity types to search (optional)
 * @param {string} channelIds - Comma-separated list of channel IDs to filter (optional)
 * @param {string} userIds - Comma-separated list of user IDs to filter messages (optional)
 * @param {string} dateRange - JSON string with from/to dates (optional)
 * @param {number} page - Page number for pagination (optional, default: 1)
 * @param {number} limit - Results per page (optional, default: 25, max: 100)
 * @param {string} searchType - trigram|fts|both (optional, default: both)
 * @param {string} sort - relevance|newest|oldest (optional, default: relevance)
 */
router.get('/', 
  validateQuery(searchQuerySchema), 
  searchController.globalSearch
);


export default router;
