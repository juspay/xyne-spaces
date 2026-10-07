import { Router } from 'express';
import { validate } from '../middleware/validation';
import { assistantRouteLimiter } from '../middleware/rateLimiters';
import { assistantRouteBodySchema } from '../validators/assistantRouteValidator';
import { assistantRouteHandler } from '../services/assistantRoute/handler';

const router = Router();

router.post('/', assistantRouteLimiter, validate(assistantRouteBodySchema), assistantRouteHandler);

export default router;
